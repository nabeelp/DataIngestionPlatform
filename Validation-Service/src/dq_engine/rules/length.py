from __future__ import annotations

from typing import Any

import polars as pl

from dq_engine.rules.base import RuleConfigurationError, RuleContext


def row_failure_expr(ctx: RuleContext, params: dict[str, Any]) -> pl.Expr:
    column = str(params["column"])
    if "min" not in params and "max" not in params:
        raise RuleConfigurationError("Length rules require a minimum or maximum.")
    length = ctx.text(column).str.len_chars()
    failure = pl.lit(False)
    if "min" in params:
        failure = failure | (length < int(params["min"]))
    if "max" in params:
        failure = failure | (length > int(params["max"]))
    return (~ctx.empty(column)) & failure


def describe(params: dict[str, Any]) -> str:
    return f'{params["column"]} has a valid character length.'
