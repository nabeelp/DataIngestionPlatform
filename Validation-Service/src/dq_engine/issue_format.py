from __future__ import annotations

import math
from typing import Any

import polars as pl

from dq_engine.contracts.models import RuleConfig
from dq_engine.results import CheckResult
from dq_engine.rules.base import RuleIssue


def issue_from_row(
    frame: pl.DataFrame,
    row_index: int,
    row_number: int,
    column: str | None,
    message: str,
) -> RuleIssue:
    value: str | None = None
    if column and column in frame.columns:
        raw_value = frame.item(row_index, column)
        value = display_value(raw_value)
    return RuleIssue(row=row_number, column=column, value=value, message=message)


def display_value(value: object) -> str | None:
    if value is None:
        return None
    text = str(value)
    return f"{text[:200]}..." if len(text) > 200 else text


def row_message(rule_data: dict[str, Any], column: str | None, value: object = None) -> str:
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


def error_check(rule: RuleConfig, message: str, sheet: str | None) -> CheckResult:
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


def check_status(issue_count: int, severity: str) -> str:
    if not issue_count:
        return "PASSED"
    return "WARNING" if severity == "Warning" else "FAILED"
