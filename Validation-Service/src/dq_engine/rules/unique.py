from __future__ import annotations

from typing import Any

import polars as pl

from dq_engine.rules.base import RuleContext


def row_failure_expr(ctx: RuleContext, params: dict[str, Any]) -> pl.Expr:
    columns = [str(name) for name in params["columns"]]
    values = [ctx.text(name).str.strip_chars() for name in columns]
    empty = pl.any_horizontal([ctx.empty(name) for name in columns])
    key = pl.struct(values).alias("__dq_unique_key")
    duplicate = ~key.is_first_distinct()
    return (~empty) & duplicate


def describe(params: dict[str, Any]) -> str:
    return "The configured key is unique."
