from __future__ import annotations

from typing import Any

import polars as pl

from dq_engine.rules.base import RuleConfigurationError, RuleContext


def row_failure_expr(ctx: RuleContext, params: dict[str, Any]) -> pl.Expr:
    when = params["when"]
    if not isinstance(when, dict):
        raise RuleConfigurationError("Conditional required rule has an invalid condition.")
    column = str(when["column"])
    value = ctx.text(column).str.strip_chars()
    operator = str(when["op"])
    if operator == "eq":
        condition = value == str(when["value"])
    elif operator == "ne":
        condition = value != str(when["value"])
    elif operator == "in":
        condition = value.is_in([str(item) for item in when["values"]])
    elif operator == "empty":
        condition = ctx.empty(column)
    elif operator == "notEmpty":
        condition = ~ctx.empty(column)
    else:
        raise RuleConfigurationError(f"Unsupported conditional operator: {operator}.")
    missing_values = pl.any_horizontal([ctx.empty(str(name)) for name in params["columns"]])
    return condition & missing_values


def describe(params: dict[str, Any]) -> str:
    return "Required values are present when the condition holds."
