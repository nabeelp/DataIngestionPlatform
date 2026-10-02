from __future__ import annotations

import re
from datetime import date

from sqlglot import exp, parse
from sqlglot.errors import ParseError

from dq_engine.rules.base import RuleConfigurationError

MAX_SQL_BYTES = 4 * 1024
MAX_SQL_COLUMNS = 20
_ALLOWED_FUNCTIONS = {
    "abs", "ceil", "coalesce", "count", "date_part", "ends_with", "floor", "lag", "lead", "length",
    "lower", "nullif", "regexp_like", "round", "starts_with", "strptime",
    "substr", "sum", "min", "max", "row_number", "trim", "upper",
}
_ALLOWED_NODE_TYPES = (
    exp.Add,
    exp.And,
    exp.Between,
    exp.Boolean,
    exp.Case,
    exp.Cast,
    exp.Column,
    exp.DataType,
    exp.Div,
    exp.EQ,
    exp.GT,
    exp.GTE,
    exp.Identifier,
    exp.In,
    exp.Is,
    exp.Like,
    exp.Literal,
    exp.LT,
    exp.LTE,
    exp.Mod,
    exp.Mul,
    exp.NEQ,
    exp.Neg,
    exp.Not,
    exp.Null,
    exp.Or,
    exp.Paren,
    exp.Sub,
    exp.TryCast,
    exp.When,
    exp.If,
    exp.DataTypeParam,
    exp.Var,
)


def _parse_single(sql: str) -> exp.Expr:
    if len(sql.encode("utf-8")) > MAX_SQL_BYTES:
        raise RuleConfigurationError("Natural-language SQL exceeds the 4-KB limit.")
    try:
        expressions = parse(sql, read="duckdb")
    except ParseError as error:
        raise RuleConfigurationError("Natural-language SQL could not be parsed.") from error
    if len(expressions) != 1 or expressions[0] is None:
        raise RuleConfigurationError("Natural-language SQL must contain exactly one statement.")
    return expressions[0]


def _validate_nodes(expression: exp.Expr, query_mode: bool = False) -> None:
    for node in expression.walk():
        if isinstance(node, exp.Func):
            name = node.sql_name().casefold()
            if name == "anonymous":
                name = node.name.casefold()
            name = {"str_to_time": "strptime", "substring": "substr"}.get(name, name)
            if name not in _ALLOWED_FUNCTIONS | {"cast", "try_cast"}:
                raise RuleConfigurationError(f"Function `{name}` is not allowed.")
        elif query_mode and isinstance(node, exp.Star) and isinstance(node.parent, exp.Count):
            continue
        elif query_mode and isinstance(node, (
            exp.Select, exp.From, exp.Table, exp.Join, exp.Alias, exp.With,
            exp.CTE, exp.TableAlias, exp.Subquery, exp.Where, exp.Group, exp.Having,
            exp.Order, exp.Ordered, exp.Limit, exp.Offset, exp.Distinct,
            exp.Window, exp.WindowSpec, exp.Partition,
        )):
            continue
        elif not isinstance(node, _ALLOWED_NODE_TYPES):
            raise RuleConfigurationError("Natural-language SQL contains an expression that is not allowed.")
        if isinstance(node, exp.DataType) and node.this.name.casefold() not in {
            "bigint", "boolean", "date", "decimal", "double", "float", "int", "integer",
            "real", "smallint", "string", "text", "timestamp", "varchar",
        }:
            raise RuleConfigurationError("Natural-language SQL uses a data type that is not allowed.")


def validate_row_expression(sql: str, columns: list[str]) -> str:
    if len(columns) > MAX_SQL_COLUMNS:
        raise RuleConfigurationError("Natural-language rules may reference at most 20 columns.")
    expression = _parse_single(sql)
    if isinstance(expression, (exp.Select, exp.Query)):
        raise RuleConfigurationError("Row-mode SQL must be a boolean expression, not a query.")
    _validate_nodes(expression)
    declared = {column.strip().casefold() for column in columns}
    for column in expression.find_all(exp.Column):
        if column.table or column.name.strip().casefold() not in declared:
            raise RuleConfigurationError("Natural-language SQL references an undeclared column.")
    return sql


def substitute_validation_date(sql: str, validation_date: date) -> str:
    return re.sub(
        r"(?<![\w]):validation_date(?![\w])",
        f"'{validation_date.isoformat()}'",
        sql,
        flags=re.IGNORECASE,
    )


def validate_query(sql: str, registered_tables: dict[str, list[str]]) -> str:
    if sum(
        len([column for column in columns if column.casefold() != "__row"])
        for columns in registered_tables.values()
    ) > MAX_SQL_COLUMNS:
        raise RuleConfigurationError("Natural-language rules may reference at most 20 columns.")
    expression = _parse_single(sql)
    if not isinstance(expression, exp.Select):
        raise RuleConfigurationError("Query-mode SQL must be a single SELECT statement.")
    _validate_nodes(expression, query_mode=True)
    allowed_tables = {name.casefold() for name in registered_tables}
    cte_names = {
        cte.alias_or_name.casefold()
        for cte in expression.find_all(exp.CTE)
    }
    table_aliases: dict[str, str] = {}
    for cte in expression.find_all(exp.CTE):
        sources = {
            table.name.casefold()
            for table in cte.find_all(exp.Table)
            if table.name.casefold() in allowed_tables
        }
        if len(sources) == 1:
            table_aliases[cte.alias_or_name.casefold()] = next(iter(sources))
    for table in expression.find_all(exp.Table):
        name = table.name.casefold()
        if table.db or table.catalog:
            raise RuleConfigurationError("Natural-language SQL cannot use qualified table names.")
        if name not in allowed_tables and name not in cte_names:
            raise RuleConfigurationError("Natural-language SQL references an unregistered table.")
        if name in allowed_tables:
            table_aliases[(table.alias or name).casefold()] = name
    declared = {
        table.casefold(): {column.casefold() for column in columns}
        for table, columns in registered_tables.items()
    }
    for column in expression.find_all(exp.Column):
        if column.table:
            table_name = table_aliases.get(column.table.casefold())
            if table_name is None or column.name.casefold() not in declared[table_name]:
                raise RuleConfigurationError("Natural-language SQL references an undeclared column.")
        elif column.name.casefold() == "__row":
            continue
        elif sum(column.name.casefold() in values for values in declared.values()) != 1:
            raise RuleConfigurationError("Natural-language SQL has an ambiguous or undeclared column.")
    return sql
