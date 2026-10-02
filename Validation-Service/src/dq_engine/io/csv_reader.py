from __future__ import annotations

import codecs
import csv
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import polars as pl
import pyarrow as pa
import pyarrow.csv as pyarrow_csv

from dq_engine.contracts.models import TableDefinition
from dq_engine.io.models import ParsedTable, StructuralIssue, UnrecoverableFileError


def _read_header(path: Path, encoding: str, delimiter: str, configured_header: int | None) -> tuple[list[str], int]:
    try:
        with path.open("r", encoding=encoding, newline="") as source:
            reader = csv.reader(source, delimiter=delimiter, strict=True)
            if configured_header is not None:
                for _ in range(configured_header - 1):
                    next(reader, None)
                header = next(reader, [])
                if not header:
                    return [], configured_header
                return header, reader.line_num
            for row in reader:
                if any(field.strip() for field in row):
                    return row, reader.line_num
            return [], reader.line_num
    except (OSError, UnicodeDecodeError, csv.Error) as error:
        raise UnrecoverableFileError("The CSV header could not be read.") from error


def _validate_headers(headers: list[str]) -> list[StructuralIssue]:
    issues: list[StructuralIssue] = []
    seen: dict[str, int] = {}
    for index, header in enumerate(headers, start=1):
        cleaned = header.strip()
        if not cleaned:
            issues.append(StructuralIssue(
                code="empty_header",
                message=f"Column {index} has an empty header.",
                column=str(index),
            ))
            continue
        normalized = cleaned.casefold()
        if normalized in seen:
            issues.append(StructuralIssue(
                code="duplicate_header",
                message=f"Duplicate header {cleaned!r} at columns {seen[normalized]} and {index}.",
                column=cleaned,
            ))
        else:
            seen[normalized] = index
    return issues


def _unique_headers(headers: list[str], width: int) -> list[str]:
    names = headers[:width]
    if len(names) < width:
        names.extend(f"_extra_{index}" for index in range(len(names) + 1, width + 1))
    used: set[str] = set()
    for index, header in enumerate(names):
        base = header.strip() or f"_empty_{index + 1}"
        candidate = base
        suffix = 1
        while candidate.casefold() in used:
            suffix += 1
            candidate = f"{base}_{suffix}"
        names[index] = candidate
        used.add(candidate.casefold())
    return names


def _scan_ragged_rows(
    path: Path,
    encoding: str,
    delimiter: str,
    header_line: int,
    expected_fields: int,
) -> tuple[list[list[str]], list[int], list[StructuralIssue]]:
    rows: list[list[str]] = []
    row_numbers: list[int] = []
    issues: list[StructuralIssue] = []
    try:
        with path.open("r", encoding=encoding, newline="") as source:
            reader = csv.reader(source, delimiter=delimiter, strict=True)
            while reader.line_num < header_line:
                next(reader, None)
            previous_line = reader.line_num
            for row in reader:
                start_line = previous_line + 1
                previous_line = reader.line_num
                if not row:
                    continue
                if len(row) != expected_fields:
                    issues.append(StructuralIssue(
                        code="ragged_row",
                        message=f"Expected {expected_fields} fields but found {len(row)}.",
                        row=start_line,
                    ))
                    continue
                rows.append(row)
                row_numbers.append(start_line)
    except (OSError, UnicodeDecodeError, csv.Error) as error:
        raise UnrecoverableFileError("The CSV records could not be parsed.") from error
    return rows, row_numbers, issues


def _read_pyarrow(
    path: Path,
    delimiter: str,
    header_line: int,
    names: list[str],
    invalid_rows: list[tuple[int, int]],
) -> pa.Table:
    def on_invalid_row(row: pyarrow_csv.InvalidRow) -> str:
        invalid_rows.append((row.expected_columns, row.actual_columns))
        return "skip"

    return pyarrow_csv.read_csv(
        path,
        read_options=pyarrow_csv.ReadOptions(
            skip_rows=header_line,
            column_names=names,
            encoding="utf8",
        ),
        parse_options=pyarrow_csv.ParseOptions(
            delimiter=delimiter,
            invalid_row_handler=on_invalid_row,
        ),
        convert_options=pyarrow_csv.ConvertOptions(
            column_types={name: pa.string() for name in names},
            strings_can_be_null=False,
            null_values=[],
        ),
    )


def _needs_physical_line_map(path: Path, header_line: int, data_rows: int) -> bool:
    newline_count = 0
    last_byte = b""
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            newline_count += chunk.count(b"\n")
            last_byte = chunk[-1:]
    if not path.stat().st_size:
        return False
    ends_with_newline = last_byte in (b"\n", b"\r")
    physical_lines = newline_count + (not ends_with_newline)
    return physical_lines > header_line + data_rows


@contextmanager
def _polars_compatible_path(path: Path, encoding: str) -> Iterator[Path]:
    if encoding == "utf-8":
        yield path
        return
    temporary = tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="", delete=False)
    temporary_path = Path(temporary.name)
    decoder = codecs.getincrementaldecoder(encoding)(errors="strict")
    try:
        with path.open("rb") as source:
            while chunk := source.read(64 * 1024):
                temporary.write(decoder.decode(chunk))
            temporary.write(decoder.decode(b"", final=True))
        temporary.close()
        yield temporary_path
    except (OSError, UnicodeDecodeError, LookupError) as error:
        temporary.close()
        raise UnrecoverableFileError("The CSV file cannot be decoded.") from error
    finally:
        temporary.close()
        temporary_path.unlink(missing_ok=True)


def read_csv_table(
    path: Path,
    encoding: str,
    delimiter: str,
    table: TableDefinition,
) -> ParsedTable:
    headers, header_line = _read_header(path, encoding, delimiter, table.headerRow)
    issues = _validate_headers(headers)
    if not headers:
        return ParsedTable(
            name=table.sheet or "",
            definition=table,
            frame=pl.DataFrame(schema={column.name: pl.String for column in table.columns}),
            row_numbers=[],
            source_columns=[],
            structural_issues=issues,
        )

    unique_names = _unique_headers(headers, len(headers))
    invalid_rows: list[tuple[int, int]] = []
    try:
        with _polars_compatible_path(path, encoding) as input_path:
            arrow_table = _read_pyarrow(
                input_path,
                delimiter,
                header_line,
                unique_names,
                invalid_rows,
            )
    except (pa.ArrowInvalid, pa.ArrowNotImplementedError, OSError, UnicodeDecodeError) as error:
        raise UnrecoverableFileError("The CSV records could not be parsed.") from error
    if invalid_rows:
        rows, row_numbers, ragged_issues = _scan_ragged_rows(
            path, encoding, delimiter, header_line, len(headers)
        )
        issues.extend(ragged_issues)
        frame = pl.DataFrame(
            rows,
            schema=list(zip(unique_names, [pl.String] * len(unique_names), strict=True)),
            orient="row",
        )
        return ParsedTable(
            name=table.sheet or "",
            definition=table,
            frame=frame,
            row_numbers=row_numbers,
            source_columns=headers,
            structural_issues=issues,
        )

    converted = pl.from_arrow(arrow_table)
    if not isinstance(converted, pl.DataFrame):
        raise UnrecoverableFileError("The CSV reader did not produce a table.")
    data = converted.select(unique_names).cast({name: pl.String for name in unique_names})
    if _needs_physical_line_map(path, header_line, data.height):
        _, row_numbers, line_map_issues = _scan_ragged_rows(
            path,
            encoding,
            delimiter,
            header_line,
            len(headers),
        )
        if line_map_issues:
            raise UnrecoverableFileError("The CSV reader accepted malformed records unexpectedly.")
    else:
        row_numbers = list(range(header_line + 1, header_line + 1 + data.height))
    return ParsedTable(
        name=table.sheet or "",
        definition=table,
        frame=data,
        row_numbers=row_numbers,
        source_columns=headers,
        structural_issues=issues,
    )
