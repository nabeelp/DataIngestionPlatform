from __future__ import annotations

from typing import Any

import polars as pl

from dq_engine.rules.base import RuleContext


def row_failure_expr(ctx: RuleContext, params: dict[str, Any]) -> pl.Expr:
    return pl.any_horizontal([ctx.empty(str(name)) for name in params["columns"]])


def describe(params: dict[str, Any]) -> str:
    return "Required values are present."
