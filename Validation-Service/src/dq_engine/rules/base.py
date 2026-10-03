from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any, Protocol

import polars as pl

from dq_engine.io.models import ParsedTable


class RuleConfigurationError(ValueError):
    """A rule cannot be applied to the current contract or table."""


@dataclass(frozen=True, slots=True)
class RuleIssue:
    row: int | None
    column: str | None
    value: str | None
    message: str


@dataclass(slots=True)
class FileResult:
    failed: bool
    message: str
    issues: list[RuleIssue] = field(default_factory=list)


@dataclass(slots=True)
class RuleContext:
    table: ParsedTable
    validation_date: date
    lookups: dict[str, list[str]]
    parsed_columns: dict[tuple[str, str], pl.Expr] = field(default_factory=dict)

    @property
    def frame(self) -> pl.DataFrame:
        return self.table.frame

    def actual_column(self, name: str) -> str:
        normalized = name.strip()
        matches = [column for column in self.frame.columns if column.strip() == normalized]
        if len(matches) != 1:
            raise RuleConfigurationError(f'Column "{name}" is missing or ambiguous.')
        return matches[0]

    def column(self, name: str) -> pl.Expr:
        return pl.col(self.actual_column(name))

    def text(self, name: str) -> pl.Expr:
        return self.column(name).cast(pl.String, strict=False)

    def empty(self, name: str) -> pl.Expr:
        value = self.text(name)
        return value.is_null() | (value.str.strip_chars() == "")

    def cached(self, key: tuple[str, str], factory: Any) -> pl.Expr:
        if key not in self.parsed_columns:
            self.parsed_columns[key] = factory()
        return self.parsed_columns[key]

    def number(
        self,
        name: str,
        decimal_separator: str = ".",
        thousands_separator: str | None = None,
    ) -> pl.Expr:
        key = ("number", f"{name}\0{decimal_separator}\0{thousands_separator or ''}")

        def parse() -> pl.Expr:
            value = self.text(name).str.strip_chars()
            if thousands_separator:
                value = value.str.replace_all(re.escape(thousands_separator), "")
            if decimal_separator != ".":
                value = value.str.replace_all(re.escape(decimal_separator), ".")
            grammar = r"^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$"
            valid = value.str.contains(grammar)
            number = value.cast(pl.Float64, strict=False)
            return pl.when(valid & number.is_finite()).then(number).otherwise(None)

        return self.cached(key, parse)

    def parsed_date(self, name: str, formats: str | list[str] | None = None, datetime: bool = False) -> pl.Expr:
        normalized_formats = formats if isinstance(formats, list) else [formats] if formats else []
        if not normalized_formats:
            normalized_formats = (
                [
                    "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
                    "yyyy-MM-dd'T'HH:mm:ssXXX",
                    "yyyy-MM-dd HH:mm:ss",
                    "yyyy-MM-dd",
                ]
                if datetime
                else ["yyyy-MM-dd"]
            )
        key = ("datetime" if datetime else "date", f"{name}\0{'|'.join(normalized_formats)}")

        def parse() -> pl.Expr:
            value = self.text(name).str.strip_chars()
            parsed: pl.Expr | None = None
            for format_string in normalized_formats:
                format_spec = _chrono_format(format_string)
                current_value = (
                    value.str.replace_all(r"Z$", "+00:00")
                    if datetime and "XXX" in format_string
                    else value
                )
                current = current_value.str.strptime(
                    pl.Datetime if datetime else pl.Date,
                    format=format_spec,
                    strict=False,
                    exact=True,
                )
                current = pl.when(value.str.contains(_chrono_regex(format_string))).then(current)
                if datetime and "XXX" in format_string:
                    current = current.dt.convert_time_zone("UTC").dt.replace_time_zone(None)
                parsed = current if parsed is None else pl.coalesce(parsed, current)
            return parsed if parsed is not None else pl.lit(None, dtype=pl.Date)

        return self.cached(key, parse)


class RulePlugin(Protocol):
    def validate_params(self) -> None: ...

    def columns(self) -> set[str]: ...

    def row_failure_expr(self, ctx: RuleContext) -> pl.Expr | None: ...

    def file_check(self, ctx: RuleContext) -> FileResult | None: ...

    def describe(self) -> str: ...


def _chrono_format(value: str) -> str:
    translations = (
        ("yyyy", "%Y"),
        ("yy", "%y"),
        ("MM", "%m"),
        ("dd", "%d"),
        ("HH", "%H"),
        ("mm", "%M"),
        ("ss", "%S"),
        ("XXX", "%:z"),
        ("X", "%#z"),
    )
    result = value.replace("'", "").replace(".SSS", "%.3f").replace("SSS", "%.3f")
    for source, target in translations:
        result = result.replace(source, target)
    return result


def _chrono_regex(value: str) -> str:
    tokens = (
        ("yyyy", r"\d{4}"),
        ("yy", r"\d{2}"),
        ("SSS", r"\d{3}"),
        ("XXX", r"(?:Z|[+-]\d{2}:\d{2})"),
        ("XX", r"(?:Z|[+-]\d{4})"),
        ("MM", r"\d{2}"),
        ("dd", r"\d{2}"),
        ("HH", r"\d{2}"),
        ("mm", r"\d{2}"),
        ("ss", r"\d{2}"),
        ("X", r"(?:Z|[+-]\d{2}(?::?\d{2})?)"),
    )
    parts: list[str] = []
    index = 0
    while index < len(value):
        if value[index] == "'":
            end = value.find("'", index + 1)
            if end < 0:
                parts.append("'")
                index += 1
            else:
                parts.append(value[index + 1:end])
                index = end + 1
            continue
        token = next((item for item in tokens if value.startswith(item[0], index)), None)
        if token is None:
            parts.append(value[index])
            index += 1
        else:
            parts.append(token[1])
            index += len(token[0])
    return "^" + "".join(parts) + "$"


def _decimal_bound(value: Any) -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError) as error:
        raise RuleConfigurationError("Rule numeric bounds must be finite numbers.") from error


def validate_finite_bound(value: Any) -> Decimal:
    bound = _decimal_bound(value)
    if not bound.is_finite():
        raise RuleConfigurationError("Rule numeric bounds must be finite numbers.")
    return bound
