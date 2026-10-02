from __future__ import annotations

from typing import Any

import polars as pl

from dq_engine.rules.base import FileResult, RuleContext


def file_check(ctx: RuleContext, params: dict[str, Any]) -> FileResult | None:
    count = ctx.frame.height
    if "min" in params and count < int(params["min"]):
        return FileResult(True, f"Row count {count} is below the minimum {params['min']}.")
    if "max" in params and count > int(params["max"]):
        return FileResult(True, f"Row count {count} exceeds the maximum {params['max']}.")
    return None


def row_failure_expr(ctx: RuleContext, params: dict[str, Any]) -> pl.Expr | None:
    return None


def describe(params: dict[str, Any]) -> str:
    return "The table row count is within the configured bounds."
