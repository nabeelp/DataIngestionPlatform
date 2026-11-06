from __future__ import annotations

import csv
from pathlib import Path

from dq_engine.io.models import ParsedFile
from dq_engine.results import MAX_REPORT_ISSUES, ValidationOutcome


def write_outputs(
    parsed: ParsedFile,
    outcome: ValidationOutcome,
    output_directory: Path,
    report_limit: int = MAX_REPORT_ISSUES,
) -> None:
    output_directory.mkdir(parents=True, exist_ok=True)
    for index, table in enumerate(parsed.tables.values(), start=1):
        table.frame.write_parquet(output_directory / f"table-{index}.parquet", compression="zstd")
    report_path = output_directory / "issues.csv"
    exported = 0
    with report_path.open("w", encoding="utf-8-sig", newline="") as target:
        writer = csv.writer(target)
        writer.writerow(["checkId", "checkName", "sheet", "row", "column", "value", "message"])
        for report_issue in outcome.report_issues:
            if exported >= report_limit:
                break
            issue = report_issue.issue
            writer.writerow([
                report_issue.check_id,
                report_issue.check_name,
                report_issue.sheet,
                issue.row,
                issue.column,
                issue.value,
                issue.message,
            ])
            exported += 1
        if exported >= report_limit:
            writer.writerow(["", "", "", "", "", "", f"Issues report capped at {report_limit} rows."])
