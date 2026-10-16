from __future__ import annotations

import math
from typing import Any

import polars as pl

from dq_engine.rules.base import RuleConfigurationError, RuleContext


def row_failure_expr(ctx: RuleContext, params: dict[str, Any]) -> pl.Expr:
    column = str(params["column"])
    value = ctx.number(column)
    failure = value.is_null()
    if "min" in params:
        bound = float(params["min"])
        if not math.isfinite(bound):
            raise RuleConfigurationError("Rule numeric bounds must be finite numbers.")
        failure = failure | (value < bound if bool(params.get("minInclusive", True)) else value <= bound)
    if "max" in params:
        bound = float(params["max"])
        if not math.isfinite(bound):
            raise RuleConfigurationError("Rule numeric bounds must be finite numbers.")
        failure = failure | (value > bound if bool(params.get("maxInclusive", True)) else value >= bound)
    return (~ctx.empty(column)) & failure


def describe(params: dict[str, Any]) -> str:
    return f'{params["column"]} is within the configured range.'
