from __future__ import annotations

import csv
import json
import math
import multiprocessing
import queue
import re
import tempfile
import time
from dataclasses import asdict, dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

import polars as pl

from dq_engine.contracts.models import DefinitionContract, RuleConfig, TableDefinition
from dq_engine.io.models import ParsedFile, ParsedTable, StructuralIssue
from dq_engine.io.readers import read_file
from dq_engine.rules import (
    aggregate,
    compare,
    conditional_required,
    date_range,
    enum,
    length,
    lookup,
    natural_language,
    pattern,
    reconcile,
    row_count,
    sqlguard,
    type_check,
    unique,
)
from dq_engine.rules import (
    range as range_rule,
)
from dq_engine.rules.base import FileResult, RuleConfigurationError, RuleContext, RuleIssue

MAX_ISSUES_PER_CHECK = 100
MAX_REPORT_ISSUES = 1_000_000
QUERY_TIMEOUT_SECONDS = 30
_RULE_MODULES: dict[str, Any] = {
    "enum": enum,
    "range": range_rule,
    "pattern": pattern,
    "length": length,
    "unique": unique,
    "lookup": lookup,
    "dateRange": date_range,
    "conditionalRequired": conditional_required,
    "compare": compare,
    "rowCount": row_count,
    "aggregate": aggregate,
    "reconcile": reconcile,
    "naturalLanguage": natural_language,
}


@dataclass(slots=True)
class CheckResult:
    id: str
    name: str
    type: str
    severity: str
    status: str
    issue_count: int
    issues: list[RuleIssue]
    elapsed_ms: int
    sheet: str | None


@dataclass(slots=True)
class ReportIssue:
    check_id: str
    check_name: str
    sheet: str | None
    issue: RuleIssue


@dataclass(slots=True)
class ValidationOutcome:
    status: str
    checks: list[CheckResult]
    structural_issues: list[StructuralIssue]
    row_counts: dict[str, int]
    report_issues: list[ReportIssue] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "checks": [
                {
                    **asdict(check),
                    "issues": [asdict(issue) for issue in check.issues],
                }
                for check in self.checks
            ],
            "structuralIssues": [asdict(issue) for issue in self.structural_issues],
            "rowCounts": self.row_counts,
        }


@dataclass(slots=True)
class _CompiledRule:
    config: dict[str, Any]
    module: Any
    context: RuleContext
    failure_column: str
    compile_elapsed_ms: int


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


def _rule_data(rule: RuleConfig) -> dict[str, Any]:
    data = rule.model_dump(by_alias=True, exclude_none=True)
    data.setdefault("table", None)
    return data


def _rule_table(rule_data: dict[str, Any], contract: DefinitionContract) -> str | None:
    target = rule_data["table"]
    if target is None and contract.layout == "single":
        return contract.tables[0].sheet or ""
    return target if isinstance(target, str) else None


def _matches_table(rule: RuleConfig, contract: DefinitionContract, table: ParsedTable) -> bool:
    target = _rule_table(_rule_data(rule), contract)
    if contract.layout == "single":
        return rule.table is None or (
            isinstance(target, str) and table.name.strip().casefold() == target.strip().casefold()
        )
    return isinstance(target, str) and table.name.strip().casefold() == target.strip().casefold()


def _issue_from_row(
    frame: pl.DataFrame,
    row_index: int,
    row_number: int,
    column: str | None,
    message: str,
) -> RuleIssue:
    value: str | None = None
    if column and column in frame.columns:
        raw_value = frame.item(row_index, column)
        value = _display_value(raw_value)
    return RuleIssue(row=row_number, column=column, value=value, message=message)


def _display_value(value: object) -> str | None:
    if value is None:
        return None
    text = str(value)
    return f"{text[:200]}..." if len(text) > 200 else text


def _columns_for(rule_data: dict[str, Any]) -> set[str]:
    params = rule_data["params"]
    rule_type = rule_data["type"]
    if rule_type == "unique":
        return {str(item) for item in params["columns"]}
    if rule_type in {"enum", "range", "pattern", "length", "lookup", "dateRange"}:
        return {str(params["column"])}
    if rule_type == "conditionalRequired":
        return {str(params["when"]["column"]), *map(str, params["columns"])}
    if rule_type == "compare":
        return {str(params["left"]), str(params["right"])}
    if rule_type == "aggregate":
        return {str(params["column"])}
    if rule_type == "naturalLanguage":
        columns_by_table = params["columns"]
        return {
            str(column)
            for columns in columns_by_table.values()
            for column in columns
        } if isinstance(columns_by_table, dict) else set()
    return set()


def _row_message(rule_data: dict[str, Any], column: str | None, value: object = None) -> str:
    params = rule_data["params"]
    rule_type = rule_data["type"]
    if rule_type == "naturalLanguage":
        return str(params["message"])
    if rule_type == "enum":
        return f'Value not in allowed values: {", ".join(map(str, params["values"]))}'
    if rule_type == "range":
        try:
            number = float(str(value).strip())
        except (TypeError, ValueError):
            number = math.nan
        if not math.isfinite(number):
            return "Value is not a number"
        def format_bound(bound: object) -> str:
            if isinstance(bound, float) and bound.is_integer():
                return str(int(bound))
            return str(bound)

        lower = format_bound(params["min"]) if "min" in params else ""
        upper = format_bound(params["max"]) if "max" in params else ""
        return f"Value outside allowed range {lower}..{upper}"
    name = rule_data["name"]
    return f"{name} failed" + (f' for column "{column}".' if column else ".")


def _column_failure_expressions(
    context: RuleContext,
    definition: TableDefinition,
) -> tuple[list[tuple[str, pl.Expr, str]], list[tuple[str, str]]]:
    failures: list[tuple[str, pl.Expr, str]] = []
    messages: list[tuple[str, str]] = []
    source_names = context.table.source_columns
    for column in definition.columns:
        matches = [name for name in source_names if name.strip() == column.name.strip()]
        if not matches:
            if column.mustExist:
                messages.append((column.name, f'Required column "{column.name}" not found'))
            continue
        actual_name = context.actual_column(column.name)
        if not column.nullable:
            failures.append((
                actual_name,
                context.empty(column.name),
                f'Required value missing for "{column.name}"',
            ))
        if column.type != "string":
            failures.append((
                actual_name,
                type_check.row_failure_expr(context, {
                    "column": column.name,
                    "dataType": column.type,
                    "format": column.format,
                    "decimalSeparator": column.decimalSeparator,
                    "thousandsSeparator": column.thousandsSeparator,
                }),
                f"Value is not a valid {column.type}",
            ))
        if column.maxLength is not None:
            failures.append((
                actual_name,
                context.text(column.name).str.len_chars() > column.maxLength,
                f"Value exceeds maximum length {column.maxLength}",
            ))
        if column.unique:
            failures.append((
                actual_name,
                unique.row_failure_expr(context, {"columns": [column.name]}),
                "Value is not unique",
            ))
        if column.type == "decimal" and (column.precision is not None or column.scale is not None):
            decimal = context.text(column.name).str.strip_chars()
            if column.thousandsSeparator:
                decimal = decimal.str.replace_all(re.escape(column.thousandsSeparator), "")
            if column.decimalSeparator != ".":
                decimal = decimal.str.replace_all(re.escape(column.decimalSeparator), ".")
            parts = decimal.str.split(".")
            integer_digits = parts.list.get(0, null_on_oob=True).str.replace(r"^[+-]?0*", "")
            fractional = parts.list.get(1, null_on_oob=True).fill_null("")
            digit_count = integer_digits.str.len_chars() + fractional.str.len_chars()
            if column.precision is not None:
                failures.append((
                    actual_name,
                    (~context.empty(column.name)) & (digit_count > column.precision),
                    f"Value exceeds decimal precision {column.precision}",
                ))
            if column.scale is not None:
                failures.append((
                    actual_name,
                    (~context.empty(column.name)) & (fractional.str.len_chars() > column.scale),
                    f"Value exceeds decimal scale {column.scale}",
                ))
    if not definition.allowExtraColumns:
        declared = {item.name.strip().casefold() for item in definition.columns}
        for source_column in source_names:
            if source_column.strip().casefold() not in declared:
                messages.append((source_column, f'Unexpected column "{source_column}" found'))
    return failures, messages


def _make_context(parsed: ParsedTable, contract: DefinitionContract, validation_date: date) -> RuleContext:
    lookups = {key: lookup_definition.values for key, lookup_definition in contract.lookups.items()}
    return RuleContext(parsed, validation_date, lookups)


def _structural_checks(parsed: ParsedFile, checks: list[CheckResult]) -> None:
    if not parsed.structural_issues:
        return
    issues = [
        RuleIssue(issue.row, issue.column, None, issue.message)
        for issue in parsed.structural_issues
    ]
    checks.append(CheckResult(
        id="structural",
        name="Structural validation",
        type="structural",
        severity="Error",
        status="FAILED",
        issue_count=len(issues),
        issues=issues[:MAX_ISSUES_PER_CHECK],
        elapsed_ms=0,
        sheet=None,
    ))


def _error_check(rule: RuleConfig, message: str, sheet: str | None) -> CheckResult:
    return CheckResult(
        id=rule.id,
        name=rule.name,
        type=rule.type,
        severity=rule.severity,
        status="ERROR",
        issue_count=1,
        issues=[RuleIssue(None, None, None, message)],
        elapsed_ms=0,
        sheet=sheet,
    )


def _check_status(issue_count: int, severity: str) -> str:
    if not issue_count:
        return "PASSED"
    return "WARNING" if severity == "Warning" else "FAILED"


def _reconcile_result(
    rule_data: dict[str, Any],
    tables: dict[str, ParsedTable],
    validation_date: date,
    lookups: dict[str, list[str]],
) -> FileResult | None:
    params = rule_data["params"]

    def aggregate_value(reference: dict[str, Any]) -> float:
        target = str(reference["table"]).strip().casefold()
        table_name = next((name for name in tables if name.strip().casefold() == target), None)
        if table_name is None:
            raise RuleConfigurationError(f'Reconciliation table "{reference["table"]}" is missing.')
        context = RuleContext(tables[table_name], validation_date, lookups)
        try:
            column = context.actual_column(str(reference["column"]))
            value = aggregate._aggregate(context, column, str(reference["fn"]))
        except (pl.exceptions.PolarsError, KeyError) as error:
            raise RuleConfigurationError("Reconciliation column configuration is invalid.") from error
        if value is None or not math.isfinite(float(value)):
            raise RuleConfigurationError("Reconciliation aggregate is not a finite number.")
        return float(value)

    left_value = aggregate_value(params["left"])
    right_value = aggregate_value(params["right"])
    tolerance = float(params.get("tolerance", 0))
    if abs(left_value - right_value) <= tolerance:
        return None
    return FileResult(
        True,
        f"Reconciliation difference exceeds tolerance {tolerance}.",
    )


def validate_parsed(
    parsed: ParsedFile,
    contract: DefinitionContract,
    validation_date: date | None = None,
) -> ValidationOutcome:
    if validation_date is None:
        raise ValueError("A validation date is required for deterministic rule execution.")
    effective_date = validation_date
    checks: list[CheckResult] = []
    report_issues: list[ReportIssue] = []
    row_counts = {name: table.frame.height for name, table in parsed.tables.items()}
    _structural_checks(parsed, checks)
    structural_check = next((check for check in checks if check.id == "structural"), None)
    if structural_check:
        for structural_issue in parsed.structural_issues[:MAX_REPORT_ISSUES]:
            report_issues.append(ReportIssue(
                structural_check.id,
                structural_check.name,
                structural_check.sheet,
                RuleIssue(
                    structural_issue.row,
                    structural_issue.column,
                    None,
                    structural_issue.message,
                ),
            ))

    for table_name, table in parsed.tables.items():
        context = _make_context(table, contract, effective_date)
        column_started = time.perf_counter()
        column_failures, column_messages = _column_failure_expressions(context, table.definition)
        column_failure_names = [
            f"__dq_column_{index}"
            for index in range(len(column_failures))
        ]
        annotated = table.frame.lazy().with_row_index("__row")
        if column_failures:
            annotated = annotated.with_columns([
                expression.fill_null(False).alias(name)
                for (_, expression, _), name in zip(
                    column_failures,
                    column_failure_names,
                    strict=True,
                )
            ])
        rules_for_table = [
            rule for rule in contract.rules
            if rule.enabled and _matches_table(rule, contract, table)
        ]
        compiled: list[_CompiledRule] = []
        compilation_errors: list[tuple[dict[str, Any], str]] = []
        for rule in sorted(rules_for_table, key=lambda item: item.executionOrder):
            rule_data = _rule_data(rule)
            module = _RULE_MODULES[rule.type]
            compile_started = time.perf_counter()
            try:
                if rule.type != "naturalLanguage":
                    for column in _columns_for(rule_data):
                        context.actual_column(column)
                expression = module.row_failure_expr(context, rule_data["params"])
                if expression is not None:
                    failure_column = f"__dq_rule_{rule.id}"
                    annotated = annotated.with_columns(expression.fill_null(False).alias(failure_column))
                    compiled.append(_CompiledRule(
                        rule_data,
                        module,
                        context,
                        failure_column,
                        int((time.perf_counter() - compile_started) * 1000),
                    ))
            except (RuleConfigurationError, KeyError, ValueError, TypeError) as error:
                compilation_errors.append((rule_data, str(error)))

        collect_started = time.perf_counter()
        try:
            evaluated = annotated.collect(engine="streaming")
        except pl.exceptions.PolarsError:
            runtime_message = "Rule failed during execution."
            checks.append(CheckResult(
                id=f"columns:{table_name}",
                name=f'Sheet "{table_name}" columns',
                type="columns",
                severity="Error",
                status="ERROR",
                issue_count=1,
                issues=[RuleIssue(None, None, None, "Column checks failed during execution.")],
                elapsed_ms=int((time.perf_counter() - column_started) * 1000),
                sheet=table_name or None,
            ))
            if len(report_issues) < MAX_REPORT_ISSUES:
                report_issues.append(ReportIssue(
                    f"columns:{table_name}",
                    f'Sheet "{table_name}" columns',
                    table_name or None,
                    RuleIssue(None, None, None, "Column checks failed during execution."),
                ))
            checks.extend(
                _error_check(rule, "Rule failed during execution.", table_name or None)
                for rule in rules_for_table
                if rule.type != "reconcile"
                and not (rule.type == "naturalLanguage" and rule.params.mode == "query")
            )
            for rule in rules_for_table:
                if rule.type == "reconcile" or (
                    rule.type == "naturalLanguage" and rule.params.mode == "query"
                ):
                    continue
                if len(report_issues) >= MAX_REPORT_ISSUES:
                    break
                report_issues.append(ReportIssue(
                    rule.id,
                    rule.name,
                    table_name or None,
                    RuleIssue(None, None, None, runtime_message),
                ))
            continue
        collect_elapsed_ms = int((time.perf_counter() - collect_started) * 1000)
        for rule_data, compilation_message in compilation_errors:
            issue = RuleIssue(None, None, None, compilation_message)
            checks.append(CheckResult(
                id=str(rule_data["id"]),
                name=str(rule_data["name"]),
                type=str(rule_data["type"]),
                severity=str(rule_data["severity"]),
                status="ERROR",
                issue_count=1,
                issues=[issue],
                elapsed_ms=0,
                sheet=table_name or None,
            ))
            if len(report_issues) < MAX_REPORT_ISSUES:
                report_issues.append(ReportIssue(
                    str(rule_data["id"]),
                    str(rule_data["name"]),
                    table_name or None,
                    issue,
                ))
        column_issues: list[RuleIssue] = []
        column_issue_count = 0
        for column_name, message in column_messages:
            issue = RuleIssue(None, column_name, None, message)
            column_issue_count += 1
            if len(column_issues) < MAX_ISSUES_PER_CHECK:
                column_issues.append(issue)
            if len(report_issues) < MAX_REPORT_ISSUES:
                report_issues.append(ReportIssue(
                    f"columns:{table_name}",
                    f'Sheet "{table_name}" columns',
                    table_name or None,
                    issue,
                ))
        row_issues: list[tuple[int, int, int, RuleIssue]] = []
        column_orders = {
            column.name.strip(): index
            for index, column in enumerate(table.definition.columns)
        }
        for failure_index, ((column_name, _, message), result_name) in enumerate(zip(
            column_failures,
            column_failure_names,
            strict=True,
        )):
            column_indices = evaluated.get_column(result_name).arg_true().to_list()
            column_values = table.frame.get_column(column_name).gather(column_indices).to_list()
            column_issue_count += len(column_indices)
            for value_index, index in enumerate(column_indices):
                row_number = table.row_numbers[index] if index < len(table.row_numbers) else index + 1
                raw_value = column_values[value_index]
                issue = RuleIssue(
                    row_number,
                    column_name,
                    None if raw_value is None or not str(raw_value).strip() else _display_value(raw_value),
                    message,
                )
                row_issues.append((
                    row_number,
                    column_orders.get(column_name.strip(), failure_index),
                    failure_index,
                    issue,
                ))
        row_issues.sort(key=lambda item: (item[0], item[1], item[2]))
        for _, _, _, issue in row_issues:
            if len(column_issues) < MAX_ISSUES_PER_CHECK:
                column_issues.append(issue)
            if len(report_issues) < MAX_REPORT_ISSUES:
                report_issues.append(ReportIssue(
                    f"columns:{table_name}",
                    f'Sheet "{table_name}" columns',
                    table_name or None,
                    issue,
                ))
        checks.append(CheckResult(
            id=f"columns:{table_name}",
            name=f'Sheet "{table_name}" columns' if table_name else "File definition columns",
            type="columns",
            severity="Error",
            status=_check_status(column_issue_count, "Error"),
            issue_count=column_issue_count,
            issues=column_issues[:MAX_ISSUES_PER_CHECK],
            elapsed_ms=int((time.perf_counter() - column_started) * 1000),
            sheet=table_name or None,
        ))

        if table.definition.minRows is not None or table.definition.maxRows is not None:
            count = table.frame.height
            row_count_issues: list[RuleIssue] = []
            if table.definition.minRows is not None and count < table.definition.minRows:
                row_count_issues.append(RuleIssue(
                    None, None, None,
                    f"Row count {count} is below the minimum {table.definition.minRows}.",
                ))
            if table.definition.maxRows is not None and count > table.definition.maxRows:
                row_count_issues.append(RuleIssue(
                    None, None, None,
                    f"Row count {count} exceeds the maximum {table.definition.maxRows}.",
                ))
            for issue in row_count_issues:
                if len(report_issues) < MAX_REPORT_ISSUES:
                    report_issues.append(ReportIssue(
                        f"tableRows:{table_name}",
                        f'Sheet "{table_name}" row count',
                        table_name or None,
                        issue,
                    ))
            checks.append(CheckResult(
                id=f"tableRows:{table_name}",
                name=f'Sheet "{table_name}" row count',
                type="rowCount",
                severity="Error",
                status=_check_status(len(row_count_issues), "Error"),
                issue_count=len(row_count_issues),
                issues=row_count_issues[:MAX_ISSUES_PER_CHECK],
                elapsed_ms=0,
                sheet=table_name or None,
            ))

        for compiled_rule in compiled:
            rule_data = compiled_rule.config
            rule_columns = sorted(context.actual_column(column) for column in _columns_for(rule_data))
            issue_column = rule_columns[0] if len(rule_columns) == 1 else None
            failed_indices = evaluated.get_column(compiled_rule.failure_column).arg_true().to_list()
            failed_values = (
                table.frame.get_column(issue_column).gather(failed_indices).to_list()
                if issue_column and failed_indices
                else []
            )
            issues: list[RuleIssue] = []
            issue_count = len(failed_indices)
            for value_index, index in enumerate(failed_indices):
                row_number = table.row_numbers[index] if index < len(table.row_numbers) else index + 1
                raw_value = failed_values[value_index] if failed_values else None
                issue_value = None if raw_value is None else _display_value(raw_value)
                issue = RuleIssue(
                    row_number,
                    issue_column,
                    issue_value,
                    _row_message(rule_data, issue_column, raw_value),
                )
                if len(issues) < MAX_ISSUES_PER_CHECK:
                    issues.append(issue)
                if len(report_issues) < MAX_REPORT_ISSUES:
                    report_issues.append(ReportIssue(
                        str(rule_data["id"]),
                        str(rule_data["name"]),
                        table_name or None,
                        issue,
                    ))
            checks.append(CheckResult(
                id=str(rule_data["id"]),
                name=str(rule_data["name"]),
                type=str(rule_data["type"]),
                severity=str(rule_data["severity"]),
                status=_check_status(len(issues), str(rule_data["severity"])),
                issue_count=issue_count,
                issues=issues[:MAX_ISSUES_PER_CHECK],
                elapsed_ms=compiled_rule.compile_elapsed_ms + (
                    collect_elapsed_ms // max(1, len(compiled))
                ),
                sheet=table_name or None,
            ))

        for rule in rules_for_table:
            rule_data = _rule_data(rule)
            if rule.type not in {"rowCount", "aggregate"}:
                continue
            if any(error_data["id"] == rule.id for error_data, _ in compilation_errors):
                continue
            file_check_started = time.perf_counter()
            try:
                result = _RULE_MODULES[rule.type].file_check(context, rule_data["params"])
            except (RuleConfigurationError, KeyError, ValueError, TypeError, NotImplementedError) as error:
                issue = RuleIssue(None, None, None, str(error))
                checks.append(CheckResult(
                    id=str(rule_data["id"]),
                    name=str(rule_data["name"]),
                    type=str(rule_data["type"]),
                    severity=str(rule_data["severity"]),
                    status="ERROR",
                    issue_count=1,
                    issues=[issue],
                    elapsed_ms=int((time.perf_counter() - file_check_started) * 1000),
                    sheet=table_name or None,
                ))
                if len(report_issues) < MAX_REPORT_ISSUES:
                    report_issues.append(ReportIssue(
                        str(rule_data["id"]),
                        str(rule_data["name"]),
                        table_name or None,
                        issue,
                    ))
                continue
            file_issues = (
                (result.issues or [RuleIssue(None, None, None, result.message)])
                if result is not None
                else []
            )
            for issue in file_issues:
                if len(report_issues) < MAX_REPORT_ISSUES:
                    report_issues.append(ReportIssue(
                        str(rule_data["id"]),
                        str(rule_data["name"]),
                        table_name or None,
                        issue,
                    ))
            checks.append(CheckResult(
                id=str(rule_data["id"]),
                name=str(rule_data["name"]),
                type=str(rule_data["type"]),
                severity=str(rule_data["severity"]),
                status=_check_status(
                    len(file_issues) if result is not None and result.failed else 0,
                    str(rule_data["severity"]),
                ),
                issue_count=len(file_issues) if result is not None and result.failed else 0,
                issues=file_issues[:MAX_ISSUES_PER_CHECK],
                elapsed_ms=int((time.perf_counter() - file_check_started) * 1000),
                sheet=table_name or None,
            ))

    for rule in contract.rules:
        if not rule.enabled or rule.type == "reconcile":
            continue
        if rule.type == "naturalLanguage" and rule.params.mode == "query":
            continue
        target = _rule_table(_rule_data(rule), contract)
        if not any(
            (contract.layout == "single" and target in (None, "", name))
            or (
                contract.layout == "sheets"
                and isinstance(target, str)
                and target.strip().casefold() == name.strip().casefold()
            )
            for name in parsed.tables
        ):
            issue = RuleIssue(None, None, None, "The rule target table is missing.")
            checks.append(_error_check(rule, issue.message, target))
            if len(report_issues) < MAX_REPORT_ISSUES:
                report_issues.append(ReportIssue(rule.id, rule.name, target, issue))

    lookups = {key: lookup_definition.values for key, lookup_definition in contract.lookups.items()}
    for rule in contract.rules:
        if not rule.enabled or rule.type != "naturalLanguage" or rule.params.mode != "query":
            continue
        started = time.perf_counter()
        rule_data = _rule_data(rule)
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
            status=_check_status(issue_count, rule.severity),
            issue_count=issue_count,
            issues=issues[:MAX_ISSUES_PER_CHECK],
            elapsed_ms=int((time.perf_counter() - started) * 1000),
            sheet=rule.table,
        ))

    for rule in contract.rules:
        if not rule.enabled or rule.type != "reconcile":
            continue
        rule_data = _rule_data(rule)
        try:
            result = _reconcile_result(rule_data, parsed.tables, effective_date, lookups)
        except (RuleConfigurationError, KeyError, ValueError, TypeError) as error:
            result = FileResult(True, str(error))
            status = "ERROR"
        else:
            status = _check_status(1 if result else 0, rule.severity)
        issue_count = 1 if result is not None else 0
        issues = [RuleIssue(None, None, None, result.message)] if result is not None else []
        if result is not None and len(report_issues) < MAX_REPORT_ISSUES:
            report_issues.append(ReportIssue(str(rule_data["id"]), str(rule_data["name"]), None, issues[0]))
        checks.append(CheckResult(
            id=str(rule_data["id"]),
            name=str(rule_data["name"]),
            type="reconcile",
            severity=str(rule_data["severity"]),
            status=status,
            issue_count=issue_count,
            issues=issues,
            elapsed_ms=0,
            sheet=None,
        ))

    statuses = {check.status for check in checks}
    if "ERROR" in statuses or "FAILED" in statuses:
        status = "FAILED"
    elif "WARNING" in statuses:
        status = "WARNING"
    else:
        status = "PASSED"
    return ValidationOutcome(status, checks, parsed.structural_issues, row_counts, report_issues)


def validate_file(path: Path, contract: DefinitionContract, validation_date: date | None = None) -> ValidationOutcome:
    if validation_date is None:
        raise ValueError("A validation date is required for deterministic rule execution.")
    parsed = read_file(path, contract)
    return validate_parsed(parsed, contract, validation_date)


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


def load_contract(path: Path) -> DefinitionContract:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return DefinitionContract.model_validate(data)
    except (OSError, json.JSONDecodeError, ValueError) as error:
        raise ValueError("The definition contract is invalid or unreadable.") from error
