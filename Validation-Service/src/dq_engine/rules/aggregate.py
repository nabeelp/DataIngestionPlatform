from __future__ import annotations

import math
from typing import Any

import polars as pl

from dq_engine.rules.base import FileResult, RuleConfigurationError, RuleContext


def _aggregate(ctx: RuleContext, column: str, function: str) -> Any:
    if function == "sum":
        expression = ctx.number(column).sum()
    elif function == "min":
        expression = ctx.number(column).min()
    elif function == "max":
        expression = ctx.number(column).max()
    elif function == "avg":
        expression = ctx.number(column).mean()
    elif function == "count":
        expression = (~ctx.empty(column)).sum()
    elif function == "countDistinct":
        expression = ctx.text(column).filter(~ctx.empty(column)).n_unique()
    else:
        raise RuleConfigurationError(f"Unsupported aggregate function: {function}.")
    return ctx.frame.select(expression).item()


def file_check(ctx: RuleContext, params: dict[str, Any]) -> FileResult | None:
    value = _aggregate(ctx, str(params["column"]), str(params["fn"]))
    if value is None:
        return FileResult(True, "Aggregate could not be computed because no values were present.")
    if isinstance(value, float) and not math.isfinite(value):
        return FileResult(True, "Aggregate is not a finite number.")
    if "min" in params and value < float(params["min"]):
        return FileResult(True, f"Aggregate is below the minimum {params['min']}.")
    if "max" in params and value > float(params["max"]):
        return FileResult(True, f"Aggregate exceeds the maximum {params['max']}.")
    return None


def row_failure_expr(ctx: RuleContext, params: dict[str, Any]) -> pl.Expr | None:
    return None


def describe(params: dict[str, Any]) -> str:
    return f'The {params["fn"]} of {params["column"]} is within the configured bounds.'
