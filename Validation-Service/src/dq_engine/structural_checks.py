from __future__ import annotations

import re
import time

import polars as pl

from dq_engine.contracts.models import RuleConfig, TableDefinition
from dq_engine.io.models import ParsedFile, ParsedTable
from dq_engine.issue_format import check_status, display_value, error_check
from dq_engine.results import MAX_ISSUES_PER_CHECK, MAX_REPORT_ISSUES, CheckResult, ReportIssue
from dq_engine.rules import type_check, unique
from dq_engine.rules.base import RuleContext, RuleIssue


def append_structural_checks(
    parsed: ParsedFile,
    checks: list[CheckResult],
    report_issues: list[ReportIssue],
) -> None:
    if not parsed.structural_issues:
        return
    issues = [
        RuleIssue(issue.row, issue.column, None, issue.message)
        for issue in parsed.structural_issues
    ]
    structural_check = CheckResult(
        id="structural",
        name="Structural validation",
        type="structural",
        severity="Error",
        status="FAILED",
        issue_count=len(issues),
        issues=issues[:MAX_ISSUES_PER_CHECK],
        elapsed_ms=0,
        sheet=None,
    )
    checks.append(structural_check)
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


def column_failure_expressions(
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


def append_execution_failure(
    table_name: str,
    column_started: float,
    rules_for_table: list[RuleConfig],
    checks: list[CheckResult],
    report_issues: list[ReportIssue],
) -> None:
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
        error_check(rule, "Rule failed during execution.", table_name or None)
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


def append_column_check(
    table: ParsedTable,
    table_name: str,
    evaluated: pl.DataFrame,
    column_failures: list[tuple[str, pl.Expr, str]],
    column_failure_names: list[str],
    column_messages: list[tuple[str, str]],
    column_started: float,
    checks: list[CheckResult],
    report_issues: list[ReportIssue],
) -> None:
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
                None if raw_value is None or not str(raw_value).strip() else display_value(raw_value),
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
        status=check_status(column_issue_count, "Error"),
        issue_count=column_issue_count,
        issues=column_issues[:MAX_ISSUES_PER_CHECK],
        elapsed_ms=int((time.perf_counter() - column_started) * 1000),
        sheet=table_name or None,
    ))


def append_row_count_check(
    table: ParsedTable,
    table_name: str,
    checks: list[CheckResult],
    report_issues: list[ReportIssue],
) -> None:
    if table.definition.minRows is None and table.definition.maxRows is None:
        return
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
        status=check_status(len(row_count_issues), "Error"),
        issue_count=len(row_count_issues),
        issues=row_count_issues[:MAX_ISSUES_PER_CHECK],
        elapsed_ms=0,
        sheet=table_name or None,
    ))
