from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from pathlib import Path

import polars as pl

from dq_engine.contracts.models import (
    DefinitionContract,
    NaturalLanguageExample,
    NaturalLanguageRule,
    RuleConfig,
    TableDefinition,
)
from dq_engine.io.models import FileMetadata, ParsedFile, ParsedTable
from dq_engine.rules.base import RuleConfigurationError


@dataclass(frozen=True, slots=True)
class ExampleResult:
    index: int
    table: str
    expected_valid: bool
    actual_valid: bool
    passed: bool
    error: str | None


def _example_table(
    contract: DefinitionContract,
    example: NaturalLanguageExample,
) -> tuple[str, TableDefinition]:
    if contract.layout == "single":
        return example.table, contract.tables[0]
    for definition in contract.tables:
        if definition.sheet and definition.sheet.strip().casefold() == example.table.strip().casefold():
            return definition.sheet, definition
    raise RuleConfigurationError(f'Example refers to an unknown table "{example.table}".')


def _example_columns(
    rule: NaturalLanguageRule,
    table_name: str,
    definition: TableDefinition,
) -> list[str]:
    columns_by_table = rule.params.columns
    columns = next(
        (
            values
            for name, values in columns_by_table.items()
            if name.strip().casefold() == table_name.strip().casefold()
        ),
        [],
    )
    if not columns and len(columns_by_table) == 1:
        columns = next(iter(columns_by_table.values()))
    return list(dict.fromkeys([column.name for column in definition.columns] + columns))


def _parsed_example(
    contract: DefinitionContract,
    rule: NaturalLanguageRule,
    example: NaturalLanguageExample,
) -> ParsedFile:
    selected_table_name, selected_definition = _example_table(contract, example)
    if not set(example.values).issubset(set(_example_columns(rule, selected_table_name, selected_definition))):
        raise RuleConfigurationError("Example values contain undeclared columns.")

    tables: dict[str, ParsedTable] = {}
    for definition in contract.tables:
        table_name = definition.sheet or selected_table_name
        columns = _example_columns(rule, table_name, definition)
        schema = {column: pl.String for column in columns}
        if table_name.strip().casefold() == selected_table_name.strip().casefold():
            frame = pl.DataFrame(
                {column: [example.values.get(column, "")] for column in columns},
                schema=schema,
            )
            row_numbers = [max(2, (definition.headerRow or 1) + 1)]
        else:
            frame = pl.DataFrame(schema=schema)
            row_numbers = []
        tables[table_name] = ParsedTable(
            name=table_name,
            definition=definition,
            frame=frame,
            row_numbers=row_numbers,
            source_columns=columns,
        )
    return ParsedFile(
        metadata=FileMetadata(Path("<natural-language-example>"), "csv", "utf-8", ","),
        tables=tables,
    )


def run_examples(
    contract: DefinitionContract,
    rule: RuleConfig,
    examples: list[NaturalLanguageExample] | None = None,
    validation_date: date | None = None,
) -> list[ExampleResult]:
    if not isinstance(rule, NaturalLanguageRule):
        raise RuleConfigurationError("Example execution requires a Natural Language rule.")
    if validation_date is None:
        raise RuleConfigurationError("A fixed validation date is required for example execution.")

    results: list[ExampleResult] = []
    for index, example in enumerate(examples if examples is not None else rule.params.examples, start=1):
        try:
            parsed = _parsed_example(contract, rule, example)
            example_contract = contract.model_copy(update={"rules": [rule]})
            from dq_engine.engine import validate_parsed

            outcome = validate_parsed(parsed, example_contract, validation_date)
            check = next((item for item in outcome.checks if item.id == rule.id), None)
            if check is None:
                raise RuleConfigurationError("The example did not produce a Natural Language rule result.")
            if check.status == "ERROR":
                raise RuleConfigurationError(check.issues[0].message)
            actual_valid = check.issue_count == 0
            error = None
        except (KeyError, TypeError, ValueError, RuleConfigurationError) as failure:
            actual_valid = False
            error = str(failure)
        results.append(ExampleResult(
            index=index,
            table=example.table,
            expected_valid=example.expectedValid,
            actual_valid=actual_valid,
            passed=actual_valid == example.expectedValid and error is None,
            error=error,
        ))
    return results
