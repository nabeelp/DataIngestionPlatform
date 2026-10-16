from __future__ import annotations

import polars as pl

from dq_engine.rules.base import FileResult, RuleConfigurationError, RuleContext


def row_failure_expr(ctx: RuleContext, params: dict[str, object]) -> pl.Expr | None:
    return None


def file_check(ctx: RuleContext, params: dict[str, object]) -> FileResult | None:
    raise RuleConfigurationError("Cross-table reconciliation is evaluated by the validation runner.")


def describe(params: dict[str, object]) -> str:
    return "The configured table aggregates reconcile within tolerance."
