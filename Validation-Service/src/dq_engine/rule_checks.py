from __future__ import annotations

import math
import time
from datetime import date
from typing import Any

import polars as pl

from dq_engine.contracts.models import DefinitionContract, RuleConfig
from dq_engine.io.models import ParsedFile, ParsedTable
from dq_engine.issue_format import check_status, display_value, error_check, row_message
from dq_engine.results import MAX_ISSUES_PER_CHECK, MAX_REPORT_ISSUES, CheckResult, ReportIssue
from dq_engine.rule_registry import RULE_MODULES, CompiledRule, columns_for, rule_data_for, rule_table
from dq_engine.rules import aggregate
from dq_engine.rules.base import FileResult, RuleConfigurationError, RuleContext, RuleIssue


def compile_rules(
    rules_for_table: list[RuleConfig],
    context: RuleContext,
    annotated: pl.LazyFrame,
) -> tuple[pl.LazyFrame, list[CompiledRule], list[tuple[dict[str, Any], str]]]:
    compiled: list[CompiledRule] = []
    compilation_errors: list[tuple[dict[str, Any], str]] = []
    for rule in sorted(rules_for_table, key=lambda item: item.executionOrder):
        rule_data = rule_data_for(rule)
        module = RULE_MODULES[rule.type]
        compile_started = time.perf_counter()
        try:
            if rule.type != "naturalLanguage":
                for column in columns_for(rule_data):
                    context.actual_column(column)
            expression = module.row_failure_expr(context, rule_data["params"])
            if expression is not None:
                failure_column = f"__dq_rule_{rule.id}"
                annotated = annotated.with_columns(expression.fill_null(False).alias(failure_column))
                compiled.append(CompiledRule(
                    rule_data,
                    module,
                    context,
                    failure_column,
                    int((time.perf_counter() - compile_started) * 1000),
                ))
        except (RuleConfigurationError, KeyError, ValueError, TypeError) as error:
            compilation_errors.append((rule_data, str(error)))
    return annotated, compiled, compilation_errors


def append_compilation_errors(
    compilation_errors: list[tuple[dict[str, Any], str]],
    table_name: str,
    checks: list[CheckResult],
    report_issues: list[ReportIssue],
) -> None:
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


def append_row_rule_checks(
    compiled: list[CompiledRule],
    table: ParsedTable,
    table_name: str,
    context: RuleContext,
    evaluated: pl.DataFrame,
    collect_elapsed_ms: int,
    checks: list[CheckResult],
    report_issues: list[ReportIssue],
) -> None:
    for compiled_rule in compiled:
        rule_data = compiled_rule.config
        rule_columns = sorted(context.actual_column(column) for column in columns_for(rule_data))
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
            issue_value = None if raw_value is None else display_value(raw_value)
            issue = RuleIssue(
                row_number,
                issue_column,
                issue_value,
                row_message(rule_data, issue_column, raw_value),
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
            status=check_status(len(issues), str(rule_data["severity"])),
            issue_count=issue_count,
            issues=issues[:MAX_ISSUES_PER_CHECK],
            elapsed_ms=compiled_rule.compile_elapsed_ms + (
                collect_elapsed_ms // max(1, len(compiled))
            ),
            sheet=table_name or None,
        ))


def append_file_rule_checks(
    rules_for_table: list[RuleConfig],
    compilation_errors: list[tuple[dict[str, Any], str]],
    context: RuleContext,
    table_name: str,
    checks: list[CheckResult],
    report_issues: list[ReportIssue],
) -> None:
    for rule in rules_for_table:
        rule_data = rule_data_for(rule)
        if rule.type not in {"rowCount", "aggregate"}:
            continue
        if any(error_data["id"] == rule.id for error_data, _ in compilation_errors):
            continue
        file_check_started = time.perf_counter()
        try:
            result = RULE_MODULES[rule.type].file_check(context, rule_data["params"])
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
            status=check_status(
                len(file_issues) if result is not None and result.failed else 0,
                str(rule_data["severity"]),
            ),
            issue_count=len(file_issues) if result is not None and result.failed else 0,
            issues=file_issues[:MAX_ISSUES_PER_CHECK],
            elapsed_ms=int((time.perf_counter() - file_check_started) * 1000),
            sheet=table_name or None,
        ))


def append_missing_target_checks(
    contract: DefinitionContract,
    parsed: ParsedFile,
    checks: list[CheckResult],
    report_issues: list[ReportIssue],
) -> None:
    for rule in contract.rules:
        if not rule.enabled or rule.type == "reconcile":
            continue
        if rule.type == "naturalLanguage" and rule.params.mode == "query":
            continue
        target = rule_table(rule_data_for(rule), contract)
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
            checks.append(error_check(rule, issue.message, target))
            if len(report_issues) < MAX_REPORT_ISSUES:
                report_issues.append(ReportIssue(rule.id, rule.name, target, issue))


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


def append_reconcile_checks(
    contract: DefinitionContract,
    parsed: ParsedFile,
    effective_date: date,
    checks: list[CheckResult],
    report_issues: list[ReportIssue],
) -> None:
    lookups = {key: lookup_definition.values for key, lookup_definition in contract.lookups.items()}
    for rule in contract.rules:
        if not rule.enabled or rule.type != "reconcile":
            continue
        rule_data = rule_data_for(rule)
        try:
            result = _reconcile_result(rule_data, parsed.tables, effective_date, lookups)
        except (RuleConfigurationError, KeyError, ValueError, TypeError) as error:
            result = FileResult(True, str(error))
            status = "ERROR"
        else:
            status = check_status(1 if result else 0, rule.severity)
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
