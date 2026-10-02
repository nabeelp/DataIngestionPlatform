from __future__ import annotations

import re
from calendar import monthrange
from datetime import date, timedelta
from typing import Any

import polars as pl

from dq_engine.rules.base import RuleConfigurationError, RuleContext

_RELATIVE_PART = re.compile(r"([0-9]+)([YMWD])")


def _resolve_bound(bound: Any, validation_date: date) -> str:
    if isinstance(bound, str):
        try:
            return date.fromisoformat(bound).isoformat()
        except ValueError as error:
            raise RuleConfigurationError("Date range bounds must be valid ISO calendar dates.") from error
    if not isinstance(bound, dict) or not isinstance(bound.get("relative"), str):
        raise RuleConfigurationError("Date range bounds must be ISO dates or supported relative periods.")
    period = bound["relative"]
    parts = _RELATIVE_PART.findall(period.removeprefix("P-"))
    if not parts or "".join(amount + unit for amount, unit in parts) != period.removeprefix("P-"):
        raise RuleConfigurationError("Invalid relative date period.")
    current = validation_date
    for amount_text, unit in parts:
        amount = int(amount_text)
        if unit == "Y":
            month = current.month
            year = current.year - amount
            current = current.replace(year=year, day=min(current.day, monthrange(year, month)[1]))
        elif unit == "M":
            index = current.year * 12 + current.month - 1 - amount
            year, month_index = divmod(index, 12)
            month = month_index + 1
            current = current.replace(year=year, month=month, day=min(current.day, monthrange(year, month)[1]))
        elif unit == "W":
            current -= timedelta(weeks=amount)
        else:
            current -= timedelta(days=amount)
    return current.isoformat()


def row_failure_expr(ctx: RuleContext, params: dict[str, object]) -> pl.Expr:
    column = str(params["column"])
    value = ctx.parsed_date(column, None, datetime=False)
    failure = value.is_null()
    if "min" in params:
        bound = _resolve_bound(params["min"], ctx.validation_date)
        limit = pl.lit(date.fromisoformat(bound), dtype=pl.Date)
        failure = failure | (value < limit)
    if "max" in params:
        bound = _resolve_bound(params["max"], ctx.validation_date)
        limit = pl.lit(date.fromisoformat(bound), dtype=pl.Date)
        failure = failure | (value > limit)
    return (~ctx.empty(column)) & failure


def describe(params: dict[str, object]) -> str:
    return f'{params["column"]} falls within the configured date range.'
