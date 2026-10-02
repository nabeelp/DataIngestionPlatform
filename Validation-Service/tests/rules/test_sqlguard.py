from __future__ import annotations

from datetime import date

import pytest

from dq_engine.rules.base import RuleConfigurationError
from dq_engine.rules.sqlguard import (
    substitute_validation_date,
    validate_query,
    validate_row_expression,
)


def test_row_guard_accepts_declared_boolean_expression() -> None:
    sql = "TRY_CAST(Discount AS DOUBLE) > TRY_CAST(Amount AS DOUBLE) * 0.5"

    assert validate_row_expression(sql, ["Discount", "Amount"]) == sql


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT * FROM t_0",
        "read_csv('private.csv')",
        "Amount > 0; DROP TABLE t_0",
        "Undeclared > 0",
        "now() > Amount",
    ],
)
def test_row_guard_rejects_queries_undeclared_columns_and_unsafe_functions(sql: str) -> None:
    with pytest.raises(RuleConfigurationError):
        validate_row_expression(sql, ["Amount"])


def test_row_guard_enforces_sql_byte_limit() -> None:
    with pytest.raises(RuleConfigurationError, match="4-KB"):
        validate_row_expression("x" * 4097, ["Amount"])


def test_query_guard_allows_only_declared_tables_and_columns() -> None:
    sql = "SELECT __row FROM t_0 WHERE Amount > 0"

    assert validate_query(sql, {"t_0": ["Amount"]}) == sql


def test_query_guard_accepts_ctes_joins_and_count_star_over_declared_tables() -> None:
    sql = "WITH q AS (SELECT Amount FROM t_0) SELECT COUNT(*) FROM q"

    assert validate_query(sql, {"t_0": ["Amount"]}) == sql


def test_validation_date_is_substituted_as_a_fixed_sql_literal() -> None:
    sql = "OrderDate >= :validation_date"

    assert substitute_validation_date(sql, date(2025, 1, 15)) == "OrderDate >= '2025-01-15'"


@pytest.mark.parametrize(
    "sql",
    [
        "DELETE FROM t_0",
        "SELECT * FROM t_1",
        "SELECT Secret FROM t_0",
        "SELECT read_csv('private.csv') FROM t_0",
        "SELECT Amount FROM t_0; SELECT Amount FROM t_0",
    ],
)
def test_query_guard_rejects_non_selects_unregistered_sources_and_functions(sql: str) -> None:
    with pytest.raises(RuleConfigurationError):
        validate_query(sql, {"t_0": ["Amount"]})
