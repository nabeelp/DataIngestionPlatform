from __future__ import annotations

import fastexcel
import polars as pl

from dq_engine.contracts.models import DefinitionContract, TableDefinition
from dq_engine.io.models import (
    FileMetadata,
    ParsedFile,
    ParsedTable,
    StructuralIssue,
    UnrecoverableFileError,
)


def _normalize_sheet(name: str) -> str:
    return " ".join(name.strip().casefold().split())


def _header_index(frame: pl.DataFrame, configured_header: int | None) -> int | None:
    if configured_header is not None:
        index = configured_header - 1
        return index if index < frame.height else None
    for index, row in enumerate(frame.iter_rows()):
        if any(value is not None and str(value).strip() for value in row):
            return index
    return None


def _make_table(
    name: str,
    definition: TableDefinition,
    sheet: fastexcel.ExcelSheet,
) -> ParsedTable:
    raw = sheet.to_polars()
    header_index = _header_index(raw, definition.headerRow)
    if header_index is None:
        return ParsedTable(
            name=name,
            definition=definition,
            frame=pl.DataFrame(schema={column.name: pl.String for column in definition.columns}),
            row_numbers=[],
            source_columns=[],
        )

    headers = ["" if value is None else str(value) for value in raw.row(header_index)]
    header_issues: list[StructuralIssue] = []
    seen: dict[str, int] = {}
    for position, header in enumerate(headers, start=1):
        cleaned = header.strip()
        if not cleaned:
            header_issues.append(StructuralIssue(
                code="empty_header",
                message=f"Column {position} has an empty header.",
                column=str(position),
            ))
        elif cleaned.casefold() in seen:
            header_issues.append(StructuralIssue(
                code="duplicate_header",
                message=f"Duplicate header {cleaned!r} at columns {seen[cleaned.casefold()]} and {position}.",
                column=cleaned,
            ))
        else:
            seen[cleaned.casefold()] = position

    data = raw.slice(header_index + 1)
    target_names = [
        header.strip() or f"_empty_{position}"
        for position, header in enumerate(headers, start=1)
    ]
    used_target_names: set[str] = set()
    for index, name in enumerate(target_names):
        candidate = name
        suffix = 1
        while candidate.casefold() in used_target_names:
            suffix += 1
            candidate = f"{name}_{suffix}"
        target_names[index] = candidate
        used_target_names.add(candidate.casefold())
    data = data.rename(dict(zip(data.columns, target_names, strict=True)))
    data = data.select(pl.all().cast(pl.String, strict=False))
    return ParsedTable(
        name=name,
        definition=definition,
        frame=data,
        row_numbers=list(range(header_index + 2, header_index + 2 + data.height)),
        source_columns=headers,
        structural_issues=header_issues,
    )


def read_excel(metadata: FileMetadata, contract: DefinitionContract) -> ParsedFile:
    try:
        reader = fastexcel.read_excel(metadata.path)
    except (OSError, fastexcel.FastExcelError) as error:
        raise UnrecoverableFileError("The Excel workbook is corrupt, encrypted, or unsupported.") from error

    sheet_names = list(reader.sheet_names)
    by_normalized_name = {_normalize_sheet(name): index for index, name in enumerate(sheet_names)}
    tables: dict[str, ParsedTable] = {}
    file_issues: list[StructuralIssue] = []

    if contract.layout == "single":
        ignored = {_normalize_sheet(name) for name in contract.ignoredSheets}
        configured_sheet = contract.tables[0].sheet
        if configured_sheet is not None:
            selected_name = configured_sheet
        else:
            selected_name = ""
            for name in sheet_names:
                if _normalize_sheet(name) in ignored:
                    continue
                candidate = reader.load_sheet_by_idx(
                    by_normalized_name[_normalize_sheet(name)],
                    header_row=None,
                    dtype_coercion="coerce",
                )
                if str(candidate.visible).casefold() == "visible":
                    selected_name = name
                    break
        selected_definitions = [(contract.tables[0], selected_name)] if selected_name else []
    else:
        selected_definitions = []
        for table in contract.tables:
            if table.sheet is None:
                raise UnrecoverableFileError("A sheet-layout table is missing its sheet name.")
            selected_definitions.append((table, table.sheet))

    if contract.layout == "single" and not selected_definitions:
        file_issues.append(StructuralIssue(code="missing_sheet", message="The workbook has no readable worksheet."))

    for table_definition, selected_name in selected_definitions:
        index = by_normalized_name.get(_normalize_sheet(selected_name))
        if index is None:
            file_issues.append(StructuralIssue(
                code="missing_sheet",
                message=f'Required sheet "{selected_name}" not found.',
            ))
            continue
        try:
            sheet = reader.load_sheet_by_idx(index, header_row=None, dtype_coercion="coerce")
            visible = str(sheet.visible).casefold() == "visible"
            explicitly_configured = table_definition.sheet is not None
            ignored = {_normalize_sheet(name) for name in contract.ignoredSheets}
            if (not visible and not explicitly_configured) or _normalize_sheet(selected_name) in ignored:
                continue
            parsed_table = _make_table(selected_name, table_definition, sheet)
            tables[selected_name] = parsed_table
            file_issues.extend(parsed_table.structural_issues)
        except (OSError, fastexcel.FastExcelError, pl.exceptions.PolarsError) as error:
            raise UnrecoverableFileError("An Excel worksheet could not be read.") from error

    return ParsedFile(
        metadata=metadata,
        tables=tables,
        structural_issues=file_issues,
    )
