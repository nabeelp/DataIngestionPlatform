from __future__ import annotations

import polars as pl

from dq_engine.rules.base import RuleConfigurationError, RuleContext


def row_failure_expr(ctx: RuleContext, params: dict[str, object]) -> pl.Expr:
    lookup_id = str(params["lookupId"])
    if lookup_id not in ctx.lookups:
        raise RuleConfigurationError(f'Lookup "{lookup_id}" is not present in the contract snapshot.')
    values = ctx.lookups[lookup_id]
    column = str(params["column"])
    value = ctx.text(column)
    if not bool(params.get("caseSensitive", True)):
        value = value.str.to_lowercase()
        values = [item.lower() for item in values]
    return (~ctx.empty(column)) & (~value.is_in(values))


def describe(params: dict[str, object]) -> str:
    return f'{params["column"]} exists in the configured lookup.'
