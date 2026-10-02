from __future__ import annotations

from typing import Any

import polars as pl

from dq_engine.rules.base import FileResult, RuleContext, RuleIssue


def columns(params: dict[str, Any]) -> set[str]:
    return {str(name) for name in params["columns"]}


def row_failure_expr(ctx: RuleContext, params: dict[str, Any]) -> pl.Expr | None:
    return None


def file_check(ctx: RuleContext, params: dict[str, Any]) -> FileResult | None:
    missing = sorted(name for name in columns(params) if not any(
        item.strip().casefold() == name.strip().casefold() for item in ctx.table.source_columns
    ))
    if not missing:
        return None
    issues = [RuleIssue(None, name, None, f'Required column "{name}" not found.') for name in missing]
    return FileResult(failed=True, message=issues[0].message, issues=issues)


def describe(params: dict[str, Any]) -> str:
    return "Required columns are present."
