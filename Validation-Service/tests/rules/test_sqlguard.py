from __future__ import annotations

from datetime import date

import polars as pl
import pytest

from dq_engine.rules.base import RuleConfigurationError
from dq_engine.rules.sqlguard import (
    substitute_validation_date,
    validate_query,
    validate_row_expression,
)

_ALLOWED_POLARS_SQL = [
    "SELECT ABS(-1) AS result FROM t_0 LIMIT 1",
    "SELECT CEIL(1.2) AS result FROM t_0 LIMIT 1",
    "SELECT COALESCE(NULL, 1) AS result FROM t_0 LIMIT 1",
    "SELECT COUNT(*) AS result FROM t_0",
    "SELECT DATE_PART('year', EventDate) AS result FROM t_0 LIMIT 1",
    "SELECT ENDS_WITH('abc', 'c') AS result FROM t_0 LIMIT 1",
    "SELECT FLOOR(1.8) AS result FROM t_0 LIMIT 1",
    "SELECT LAG(Amount) OVER (ORDER BY __row) AS result FROM t_0",
    "SELECT LEAD(Amount) OVER (ORDER BY __row) AS result FROM t_0",
    "SELECT LENGTH('abc') AS result FROM t_0 LIMIT 1",
    "SELECT LOWER('ABC') AS result FROM t_0 LIMIT 1",
    "SELECT NULLIF(1, 1) AS result FROM t_0 LIMIT 1",
    "SELECT REGEXP_LIKE('abc', 'a.*') AS result FROM t_0 LIMIT 1",
    "SELECT ROUND(1.25, 1) AS result FROM t_0 LIMIT 1",
    "SELECT STARTS_WITH('abc', 'a') AS result FROM t_0 LIMIT 1",
    "SELECT STRPTIME('2024-01-01', '%Y-%m-%d') AS result FROM t_0 LIMIT 1",
    "SELECT SUBSTR('abc', 1, 2) AS result FROM t_0 LIMIT 1",
    "SELECT SUM(TRY_CAST(Amount AS DOUBLE)) AS result FROM t_0",
    "SELECT MIN(TRY_CAST(Amount AS DOUBLE)) AS result FROM t_0",
    "SELECT MAX(TRY_CAST(Amount AS DOUBLE)) AS result FROM t_0",
    "SELECT ROW_NUMBER() OVER (ORDER BY __row) AS result FROM t_0",
    "SELECT TRIM(' abc ') AS result FROM t_0 LIMIT 1",
    "SELECT UPPER('abc') AS result FROM t_0 LIMIT 1",
]


def test_row_guard_accepts_declared_boolean_expression() -> None:
    sql = "TRY_CAST(Discount AS DOUBLE) > TRY_CAST(Amount AS DOUBLE) * 0.5"

    assert validate_row_expression(sql, ["Discount", "Amount"]) == sql


def test_row_guard_accepts_boolean_conjunctions_and_disjunctions() -> None:
    sql = (
        "(PaymentStatus = 'Refunded' AND TotalAmount != DiscountAmount) "
        "OR (PaymentStatus != 'Refunded' AND DiscountAmount != 0)"
    )

    assert validate_row_expression(sql, ["PaymentStatus", "TotalAmount", "DiscountAmount"]) == sql


def test_row_guard_executes_casted_numeric_conditions_over_string_columns() -> None:
    sql = (
        "(PaymentStatus = 'Refunded' AND TRY_CAST(TotalAmount AS DOUBLE) != TRY_CAST(DiscountAmount AS DOUBLE)) "
        "OR (PaymentStatus != 'Refunded' AND TRY_CAST(DiscountAmount AS DOUBLE) != 0)"
    )
    frame = pl.DataFrame({
        "PaymentStatus": ["Refunded", "Refunded", "Paid", "Paid"],
        "TotalAmount": ["25.00", "25.00", "25.00", "25.00"],
        "DiscountAmount": ["25.00", "5.00", "0", "1.00"],
    })

    assert validate_row_expression(sql, ["PaymentStatus", "TotalAmount", "DiscountAmount"]) == sql
    assert frame.select(pl.sql_expr(sql).alias("fails"))["fails"].to_list() == [False, True, False, True]


def test_row_guard_accepts_case_expressions_without_allowing_if_functions() -> None:
    sql = "CASE WHEN PaymentStatus = 'Refunded' THEN TotalAmount != DiscountAmount ELSE DiscountAmount != 0 END"

    assert validate_row_expression(sql, ["PaymentStatus", "TotalAmount", "DiscountAmount"]) == sql
    with pytest.raises(RuleConfigurationError, match="Function `if` is not allowed"):
        validate_row_expression("IF(Amount > 0, TRUE, FALSE)", ["Amount"])


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT * FROM t_0",
        "read_csv('private.csv')",
        "read_parquet('private.parquet')",
        "read_json('private.json')",
        "Amount > 0; DROP TABLE t_0",
        "Undeclared > 0",
        "now() > Amount",
        "current_date > DATE '2024-01-01'",
        "random() > 0",
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


@pytest.mark.parametrize("sql", _ALLOWED_POLARS_SQL)
def test_query_guard_allows_and_executes_every_listed_polars_sql_function(sql: str) -> None:
    frame = pl.DataFrame({
        "Amount": ["1", "2", "3"],
        "__row": [0, 1, 2],
        "EventDate": pl.Series("EventDate", ["2024-01-01"] * 3).str.to_date(),
    })

    assert validate_query(sql, {"t_0": ["Amount", "__row", "EventDate"]}) == sql
    result = pl.SQLContext(t_0=frame).execute(sql, eager=True)

    assert result.height > 0


def test_validation_date_is_substituted_as_a_fixed_sql_literal() -> None:
    sql = "OrderDate >= :validation_date"

    assert substitute_validation_date(sql, date(2025, 1, 15)) == "OrderDate >= '2025-01-15'"


@pytest.mark.parametrize(
    "sql",
    [
        "DELETE FROM t_0",
        "CREATE TABLE t_1 (Amount INT)",
        "INSERT INTO t_0 VALUES (1)",
        "UPDATE t_0 SET Amount = 1",
        "SET enable_object_cache = true",
        "PRAGMA version",
        "SELECT * FROM t_1",
        "SELECT Secret FROM t_0",
        "SELECT read_csv('private.csv') FROM t_0",
        "SELECT read_parquet('private.parquet') FROM t_0",
        "SELECT read_json('private.json') FROM t_0",
        "SELECT now() FROM t_0",
        "SELECT current_date FROM t_0",
        "SELECT random() FROM t_0",
        "SELECT Amount FROM t_0; SELECT Amount FROM t_0",
    ],
)
def test_query_guard_rejects_non_selects_unregistered_sources_and_functions(sql: str) -> None:
    with pytest.raises(RuleConfigurationError):
        validate_query(sql, {"t_0": ["Amount"]})
