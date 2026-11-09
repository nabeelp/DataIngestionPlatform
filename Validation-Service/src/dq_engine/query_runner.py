from __future__ import annotations

import multiprocessing
import queue
import tempfile
import time
from datetime import date
from pathlib import Path
from typing import Any

import polars as pl

from dq_engine.contracts.models import DefinitionContract
from dq_engine.io.models import ParsedFile, ParsedTable
from dq_engine.issue_format import check_status
from dq_engine.results import MAX_ISSUES_PER_CHECK, MAX_REPORT_ISSUES, CheckResult, ReportIssue
from dq_engine.rule_registry import rule_data_for
from dq_engine.rules import sqlguard
from dq_engine.rules.base import RuleConfigurationError, RuleContext, RuleIssue

QUERY_TIMEOUT_SECONDS = 30


def _sql_query_worker(
    sql: str,
    ipc_files: dict[str, str],
    result_queue: multiprocessing.queues.Queue[Any],
) -> None:
    try:
        context = pl.SQLContext()
        for name, path in ipc_files.items():
            context.register(name, pl.read_ipc(path))
        result = context.execute(sql, eager=True)
        result_queue.put((True, result.columns, result.height, result.head(MAX_REPORT_ISSUES + 1).to_dicts()))
    except (pl.exceptions.PolarsError, OSError, ValueError, KeyError):
        result_queue.put((False, [], 0, []))


def _run_query_process(sql: str, frames: dict[str, pl.DataFrame]) -> tuple[list[str], int, list[dict[str, Any]]]:
    with tempfile.TemporaryDirectory(prefix="dq-query-") as directory:
        ipc_files: dict[str, str] = {}
        for index, (name, frame) in enumerate(frames.items()):
            path = Path(directory) / f"table-{index}.ipc"
            frame.write_ipc(path)
            ipc_files[name] = str(path)

        context = multiprocessing.get_context("spawn")
        result_queue: multiprocessing.queues.Queue[Any] = context.Queue(maxsize=1)
        process = context.Process(target=_sql_query_worker, args=(sql, ipc_files, result_queue))
        process.start()
        deadline = time.monotonic() + QUERY_TIMEOUT_SECONDS
        result: tuple[bool, list[str], int, list[dict[str, Any]]] | None = None
        while process.is_alive() and time.monotonic() < deadline and result is None:
            try:
                result = result_queue.get(timeout=min(0.1, deadline - time.monotonic()))
            except queue.Empty:
                pass
        process.join(max(0, deadline - time.monotonic()))
        if process.is_alive():
            process.terminate()
            process.join()
            result_queue.close()
            raise RuleConfigurationError("Query-mode rule exceeded the 30-second execution limit.")
        if result is None:
            try:
                result = result_queue.get(timeout=1)
            except queue.Empty as error:
                raise RuleConfigurationError("Query-mode rule failed during execution.") from error
        result_queue.close()
        succeeded, columns, row_count, rows = result
        if process.exitcode != 0 or not succeeded:
            raise RuleConfigurationError("Query-mode rule failed during execution.")
        return columns, row_count, rows


def _query_rule_issues(
    rule_data: dict[str, Any],
    contract: DefinitionContract,
    parsed: ParsedFile,
    validation_date: date,
) -> tuple[list[RuleIssue], int, list[str | None]]:
    params = rule_data["params"]
    declared_by_table = params["columns"]
    registered_columns: dict[str, list[str]] = {}
    frames: dict[str, pl.DataFrame] = {}
    table_by_registered_name: dict[str, ParsedTable] = {}
    table_aliases: dict[str, str] = {}
    for index, definition in enumerate(contract.tables):
        table_name = definition.sheet or (
            next(iter(parsed.tables), "") if contract.layout == "single" else ""
        )
        declared_columns = next(
            (
                columns
                for name, columns in declared_by_table.items()
                if str(name).strip().casefold() == table_name.strip().casefold()
            ),
            None,
        )
        if declared_columns is None and contract.layout == "single" and len(declared_by_table) == 1:
            declared_columns = next(iter(declared_by_table.values()))
        if declared_columns is None:
            # A cross-sheet query reads only the sheets it declares; other sheets are not registered.
            continue
        table = next(
            (value for name, value in parsed.tables.items()
             if name.strip().casefold() == table_name.strip().casefold()),
            None,
        )
        if table is None:
            raise RuleConfigurationError(f'Query-mode table "{table_name}" is missing.')
        if not isinstance(declared_columns, list):
            raise RuleConfigurationError(f'Query-mode columns for table "{table_name}" are missing.')
        registered_name = f"t_{index}"
        context = RuleContext(table, validation_date, {})
        actual_columns = [context.actual_column(str(column)) for column in declared_columns]
        # A query may only count rows (COUNT(*)), so a declared table can have no columns; row ids are still registered.
        registered_columns[registered_name] = actual_columns + ["__row"]
        if actual_columns:
            # CSV blanks are empty strings while Excel blanks are nulls; queries see one representation: NULL.
            frames[registered_name] = table.frame.select([
                pl.when(pl.col(column).cast(pl.String).str.strip_chars() == "")
                .then(None)
                .otherwise(pl.col(column).cast(pl.String))
                .alias(column)
                for column in actual_columns
            ]).with_row_index("__row")
        else:
            frames[registered_name] = pl.DataFrame(
                {"__row": pl.Series("__row", range(table.frame.height), dtype=pl.UInt32)},
            )
        table_by_registered_name[registered_name] = table
        table_aliases[table.name.strip().casefold()] = registered_name
        table_aliases[registered_name] = registered_name
    if not frames:
        raise RuleConfigurationError("Query-mode rules must declare columns for at least one table.")

    query = sqlguard.substitute_validation_date(
        str(params.get("query") or ""),
        validation_date,
    )
    sql = sqlguard.validate_query(query, registered_columns)
    columns, total_rows, rows = _run_query_process(sql, frames)
    if "__row" in columns:
        issues: list[RuleIssue] = []
        issue_sheets: list[str | None] = []
        for row in rows[:MAX_REPORT_ISSUES]:
            row_value = row["__row"]
            if not isinstance(row_value, int):
                raise RuleConfigurationError("Query-mode row identifiers must be integers.")
            table_output = row.get("table")
            result_registered_name = (
                table_aliases.get(str(table_output).strip().casefold())
                if table_output is not None
                else next(iter(frames)) if len(frames) == 1 else None
            )
            table = table_by_registered_name.get(result_registered_name or "")
            if table is None:
                raise RuleConfigurationError("Query-mode results must identify the failing table.")
            if row_value < 0 or row_value >= table.frame.height:
                raise RuleConfigurationError("Query-mode result contains an invalid row identifier.")
            physical_row = (
                table.row_numbers[row_value]
                if row_value < len(table.row_numbers)
                else row_value + 1
            )
            issue_column = row.get("column")
            issue_message = row.get("message") or params["message"]
            issue_sheets.append(table.name or None if contract.layout == "sheets" else None)
            issues.append(RuleIssue(
                physical_row,
                str(issue_column) if issue_column is not None else None,
                None,
                str(issue_message),
            ))
        return issues, total_rows, issue_sheets
    if "message" not in columns:
        raise RuleConfigurationError("Query-mode results must include __row or a message column.")
    if total_rows > 1:
        raise RuleConfigurationError("File-level query-mode rules must return at most one message row.")
    return (
        [RuleIssue(None, None, None, str(rows[0]["message"] or params["message"]))] if rows else [],
        total_rows,
        [None] if rows else [],
    )


def append_query_checks(
    contract: DefinitionContract,
    parsed: ParsedFile,
    effective_date: date,
    checks: list[CheckResult],
    report_issues: list[ReportIssue],
) -> None:
    for rule in contract.rules:
        if not rule.enabled or rule.type != "naturalLanguage" or rule.params.mode != "query":
            continue
        started = time.perf_counter()
        rule_data = rule_data_for(rule)
        try:
            issues, issue_count, issue_sheets = _query_rule_issues(
                rule_data,
                contract,
                parsed,
                effective_date,
            )
        except (RuleConfigurationError, KeyError, ValueError, TypeError) as error:
            issue = RuleIssue(None, None, None, str(error))
            if len(report_issues) < MAX_REPORT_ISSUES:
                report_issues.append(ReportIssue(rule.id, rule.name, rule.table, issue))
            checks.append(CheckResult(
                id=rule.id,
                name=rule.name,
                type=rule.type,
                severity=rule.severity,
                status="ERROR",
                issue_count=1,
                issues=[issue],
                elapsed_ms=int((time.perf_counter() - started) * 1000),
                sheet=rule.table,
            ))
            continue
        for issue, issue_sheet in zip(issues, issue_sheets, strict=True):
            if len(report_issues) >= MAX_REPORT_ISSUES:
                break
            report_issues.append(ReportIssue(rule.id, rule.name, issue_sheet or rule.table, issue))
        checks.append(CheckResult(
            id=rule.id,
            name=rule.name,
            type=rule.type,
            severity=rule.severity,
            status=check_status(issue_count, rule.severity),
            issue_count=issue_count,
            issues=issues[:MAX_ISSUES_PER_CHECK],
            elapsed_ms=int((time.perf_counter() - started) * 1000),
            sheet=rule.table,
        ))
