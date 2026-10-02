from __future__ import annotations

import argparse
import csv
import gc
import json
import statistics
import tempfile
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import polars as pl
import pyarrow.csv as pyarrow_csv
from generate_csv import generate


def _scan_ragged_rows(path: Path) -> list[int]:
    ragged_lines: list[int] = []
    with path.open("r", encoding="utf-8", newline="") as source:
        reader = csv.reader(source, strict=True)
        try:
            header = next(reader)
        except StopIteration:
            return ragged_lines

        expected_fields = len(header)
        previous_line = reader.line_num
        for row in reader:
            start_line = previous_line + 1
            previous_line = reader.line_num
            if not row:
                continue
            if len(row) != expected_fields:
                ragged_lines.append(start_line)
    return ragged_lines


def _time_polars(path: Path) -> tuple[float, int]:
    started = time.perf_counter()
    frame = pl.read_csv(path, infer_schema=False, try_parse_dates=False)
    elapsed = time.perf_counter() - started
    return elapsed, frame.height


def _time_pyarrow(path: Path) -> tuple[float, int, list[dict[str, int | None]]]:
    invalid_rows: list[dict[str, Any]] = []

    def on_invalid_row(row: pyarrow_csv.InvalidRow) -> str:
        invalid_rows.append({
            "number": row.number,
            "expected_columns": row.expected_columns,
            "actual_columns": row.actual_columns,
            "text_length": len(row.text),
        })
        return "skip"

    started = time.perf_counter()
    table = pyarrow_csv.read_csv(
        path,
        parse_options=pyarrow_csv.ParseOptions(invalid_row_handler=on_invalid_row),
    )
    elapsed = time.perf_counter() - started
    return elapsed, table.num_rows, invalid_rows


def _median_runs(operation: Callable[[], tuple[float, int]], repetitions: int) -> float:
    durations = []
    for _ in range(repetitions):
        elapsed, _ = operation()
        durations.append(elapsed)
        gc.collect()
    return statistics.median(durations)


def _make_malformed_copy(source_path: Path, target_path: Path, data_row: int) -> int:
    physical_line = data_row + 1
    with source_path.open("r", encoding="utf-8", newline="") as source:
        with target_path.open("w", encoding="utf-8", newline="") as target:
            for line_number, line in enumerate(source, start=1):
                if line_number == physical_line:
                    line = line.rstrip("\r\n") + ',extra\n'
                target.write(line)
    return physical_line


def _polars_failure_time(path: Path) -> tuple[float, str]:
    started = time.perf_counter()
    try:
        pl.read_csv(path, infer_schema=False, try_parse_dates=False)
    except pl.exceptions.PolarsError as error:
        return time.perf_counter() - started, type(error).__name__
    raise AssertionError("The strict Polars reader accepted a ragged row.")


def run(rows: int, repetitions: int) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="dq-csv-structural-spike-") as temporary:
        directory = Path(temporary)
        valid_path = directory / "valid.csv"
        malformed_path = directory / "malformed.csv"
        generate(valid_path, rows)

        exactness_path = directory / "line-check.csv"
        exactness_path.write_text('a,b\n1,2\n"multi\nline",3\n4,5,6\n', encoding="utf-8", newline="")
        exactness_lines = _scan_ragged_rows(exactness_path)
        if exactness_lines != [5]:
            raise AssertionError(f"CSV scanner line-map check failed: {exactness_lines}")

        polars_median = _median_runs(lambda: _time_polars(valid_path), repetitions)
        arrow_median = _median_runs(lambda: _time_pyarrow(valid_path)[:2], repetitions)
        scanner_started = time.perf_counter()
        scanned_valid_lines = _scan_ragged_rows(valid_path)
        scanner_seconds = time.perf_counter() - scanner_started
        if scanned_valid_lines:
            raise AssertionError("The structurally valid benchmark CSV was reported as ragged.")

        target_row = max(1, rows // 2)
        expected_bad_line = _make_malformed_copy(valid_path, malformed_path, target_row)
        polars_error_seconds, polars_error_type = _polars_failure_time(malformed_path)
        targeted_scan_started = time.perf_counter()
        malformed_lines = _scan_ragged_rows(malformed_path)
        targeted_scan_seconds = time.perf_counter() - targeted_scan_started
        if malformed_lines != [expected_bad_line]:
            raise AssertionError("CSV scanner did not return the exact physical line for the ragged row.")

        arrow_error_seconds, _, arrow_invalid_rows = _time_pyarrow(malformed_path)
        arrow_numbers = [row["number"] for row in arrow_invalid_rows]
        return {
            "rows": rows,
            "file_bytes": valid_path.stat().st_size,
            "repetitions": repetitions,
            "polars_strict_valid_median_seconds": polars_median,
            "pyarrow_valid_median_seconds": arrow_median,
            "python_csv_full_scan_valid_seconds": scanner_seconds,
            "scanner_to_polars_load_ratio": scanner_seconds / polars_median,
            "polars_ragged_failure_seconds": polars_error_seconds,
            "polars_ragged_error_type": polars_error_type,
            "targeted_rescan_seconds": targeted_scan_seconds,
            "ragged_rows_found": len(malformed_lines),
            "ragged_physical_line": malformed_lines[0],
            "expected_ragged_physical_line": expected_bad_line,
            "pyarrow_ragged_seconds": arrow_error_seconds,
            "pyarrow_invalid_row_count": len(arrow_invalid_rows),
            "pyarrow_invalid_row_numbers": arrow_numbers,
            "pyarrow_returns_exact_physical_line": bool(arrow_numbers)
            and all(number == expected_bad_line for number in arrow_numbers),
            "multiline_record_line_check": exactness_lines,
        }


def main() -> None:
    parser = argparse.ArgumentParser(description="Compare CSV structural-check approaches without logging data.")
    parser.add_argument("--rows", type=int, default=1_000_000)
    parser.add_argument("--repetitions", type=int, default=3)
    arguments = parser.parse_args()
    if arguments.rows < 2 or arguments.repetitions < 1:
        parser.error("--rows must be at least 2 and --repetitions must be positive")
    print(json.dumps(run(arguments.rows, arguments.repetitions), indent=2))


if __name__ == "__main__":
    main()
