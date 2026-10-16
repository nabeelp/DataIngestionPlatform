from __future__ import annotations

from collections.abc import Callable

import polars as pl

from dq_engine.rules.base import RuleConfigurationError, RuleContext

_OPERATORS: dict[str, Callable[[pl.Expr, pl.Expr], pl.Expr]] = {
    "lt": lambda left, right: left < right,
    "le": lambda left, right: left <= right,
    "eq": lambda left, right: left == right,
    "ne": lambda left, right: left != right,
    "ge": lambda left, right: left >= right,
    "gt": lambda left, right: left > right,
}


def row_failure_expr(ctx: RuleContext, params: dict[str, object]) -> pl.Expr:
    left_name, right_name = str(params["left"]), str(params["right"])
    as_type = str(params["as"])
    if as_type == "number":
        left, right = ctx.number(left_name), ctx.number(right_name)
    elif as_type == "date":
        left = ctx.parsed_date(left_name)
        right = ctx.parsed_date(right_name)
    elif as_type == "string":
        left, right = ctx.text(left_name), ctx.text(right_name)
    else:
        raise RuleConfigurationError(f"Unsupported compare type: {as_type}.")
    operator = str(params["op"])
    if operator not in _OPERATORS:
        raise RuleConfigurationError(f"Unsupported comparison operator: {operator}.")
    return (
        (~ctx.empty(left_name))
        & (~ctx.empty(right_name))
        & (left.is_null() | right.is_null() | (~_OPERATORS[operator](left, right)))
    )


def describe(params: dict[str, object]) -> str:
    return f'{params["left"]} {params["op"]} {params["right"]}.'
