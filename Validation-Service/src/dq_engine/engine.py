from __future__ import annotations

import json
import time
from datetime import date
from pathlib import Path

import polars as pl

from dq_engine.contracts.models import DefinitionContract
from dq_engine.io.models import ParsedFile
from dq_engine.io.readers import read_file
from dq_engine.query_runner import QUERY_TIMEOUT_SECONDS, append_query_checks
from dq_engine.report_output import write_outputs
from dq_engine.results import (
    MAX_ISSUES_PER_CHECK,
    MAX_REPORT_ISSUES,
    CheckResult,
    ReportIssue,
    ValidationOutcome,
)
from dq_engine.rule_checks import (
    append_compilation_errors,
    append_file_rule_checks,
    append_missing_target_checks,
    append_reconcile_checks,
    append_row_rule_checks,
    compile_rules,
)
from dq_engine.rule_registry import make_context, matches_table
from dq_engine.structural_checks import (
    append_column_check,
    append_execution_failure,
    append_row_count_check,
    append_structural_checks,
    column_failure_expressions,
)

__all__ = [
    "MAX_ISSUES_PER_CHECK",
    "MAX_REPORT_ISSUES",
    "QUERY_TIMEOUT_SECONDS",
    "CheckResult",
    "ReportIssue",
    "ValidationOutcome",
    "load_contract",
    "validate_file",
    "validate_parsed",
    "write_outputs",
]


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
    append_structural_checks(parsed, checks, report_issues)

    for table_name, table in parsed.tables.items():
        context = make_context(table, contract, effective_date)
        column_started = time.perf_counter()
        column_failures, column_messages = column_failure_expressions(context, table.definition)
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
            if rule.enabled and matches_table(rule, contract, table)
        ]
        annotated, compiled, compilation_errors = compile_rules(rules_for_table, context, annotated)

        collect_started = time.perf_counter()
        try:
            evaluated = annotated.collect(engine="streaming")
        except pl.exceptions.PolarsError:
            append_execution_failure(table_name, column_started, rules_for_table, checks, report_issues)
            continue
        collect_elapsed_ms = int((time.perf_counter() - collect_started) * 1000)
        append_compilation_errors(compilation_errors, table_name, checks, report_issues)
        append_column_check(
            table,
            table_name,
            evaluated,
            column_failures,
            column_failure_names,
            column_messages,
            column_started,
            checks,
            report_issues,
        )
        append_row_count_check(table, table_name, checks, report_issues)
        append_row_rule_checks(
            compiled,
            table,
            table_name,
            context,
            evaluated,
            collect_elapsed_ms,
            checks,
            report_issues,
        )
        append_file_rule_checks(rules_for_table, compilation_errors, context, table_name, checks, report_issues)

    append_missing_target_checks(contract, parsed, checks, report_issues)
    append_query_checks(contract, parsed, effective_date, checks, report_issues)
    append_reconcile_checks(contract, parsed, effective_date, checks, report_issues)

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


def load_contract(path: Path) -> DefinitionContract:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return DefinitionContract.model_validate(data)
    except (OSError, json.JSONDecodeError, ValueError) as error:
        raise ValueError("The definition contract is invalid or unreadable.") from error
