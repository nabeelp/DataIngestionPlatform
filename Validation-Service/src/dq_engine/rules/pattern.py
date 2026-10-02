from __future__ import annotations

import polars as pl

from dq_engine.rules.base import RuleConfigurationError, RuleContext


def row_failure_expr(ctx: RuleContext, params: dict[str, object]) -> pl.Expr:
    pattern = str(params["pattern"])
    if not pattern:
        raise RuleConfigurationError("Pattern rules require a non-empty pattern.")
    column = str(params["column"])
    value = ctx.text(column)
    if not bool(params.get("caseSensitive", True)):
        value = value.str.to_lowercase()
        pattern = pattern.lower()
    return (~ctx.empty(column)) & (~value.str.contains(f"^(?:{pattern})$"))


def describe(params: dict[str, object]) -> str:
    return f'{params["column"]} matches the configured pattern.'
