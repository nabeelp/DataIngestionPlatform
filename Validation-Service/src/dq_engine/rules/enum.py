from __future__ import annotations

from typing import Any

import polars as pl

from dq_engine.rules.base import RuleContext


def row_failure_expr(ctx: RuleContext, params: dict[str, Any]) -> pl.Expr:
    column = str(params["column"])
    value = ctx.text(column)
    if bool(params.get("trim", True)):
        value = value.str.strip_chars()
    choices = [str(item) for item in params["values"]]
    if not bool(params.get("caseSensitive", True)):
        value = value.str.to_lowercase()
        choices = [item.lower() for item in choices]
    return (~ctx.empty(column)) & (~value.is_in(choices))


def describe(params: dict[str, Any]) -> str:
    return f'{params["column"]} is in the allowed values.'
