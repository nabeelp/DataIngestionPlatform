from __future__ import annotations

from typing import Any

import polars as pl

from dq_engine.rules.base import RuleConfigurationError, RuleContext


def row_failure_expr(ctx: RuleContext, params: dict[str, Any]) -> pl.Expr:
    column = str(params["column"])
    data_type = str(params["dataType"])
    value = ctx.text(column)
    empty = ctx.empty(column)
    if data_type == "string":
        failure = pl.lit(False)
    elif data_type == "integer":
        parsed = value.str.strip_chars().cast(pl.Int64, strict=False)
        failure = parsed.is_null()
    elif data_type == "decimal":
        parsed = ctx.number(
            column,
            str(params.get("decimalSeparator") or "."),
            params.get("thousandsSeparator") if isinstance(params.get("thousandsSeparator"), str) else None,
        )
        failure = parsed.is_null()
    elif data_type in {"date", "datetime"}:
        parsed = ctx.parsed_date(column, params.get("format"), data_type == "datetime"        )
        failure = parsed.is_null()
    elif data_type == "boolean":
        normalized = value.str.strip_chars().str.to_lowercase()
        failure = ~normalized.is_in(["true", "false", "1", "0", "yes", "no", "y", "n"])
    else:
        raise RuleConfigurationError(f"Unsupported data type: {data_type}.")
    return (~empty) & failure
