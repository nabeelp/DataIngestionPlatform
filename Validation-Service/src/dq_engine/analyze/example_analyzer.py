from __future__ import annotations

import math
import re
from datetime import date, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

import fastexcel

from dq_engine.contracts.models import DefinitionContract, TableDefinition
from dq_engine.io.blob import BlobStore
from dq_engine.io.models import ParsedTable, UnrecoverableFileError
from dq_engine.io.readers import read_file
from dq_engine.io.sniff import sniff_file

MAX_ANALYZED_ROWS = 1_000
MAX_EXAMPLE_SHEETS = 20
MAX_SAMPLE_VALUES = 3
MAX_SAMPLE_LENGTH = 60
MAX_COLUMN_NAME_LENGTH = 100
MAX_ENUM_VALUES = 10
MAX_ENUM_VALUE_LENGTH = 50
MIN_ROWS_PER_ENUM_VALUE = 2
IDENTIFIER_WORDS = {
    "id", "key", "code", "number", "num", "no", "nr", "ref", "reference", "sku", "ean",
    "upc", "isbn", "zip", "zipcode", "postcode", "postalcode", "phone", "mobile", "fax",
    "account",
}


def _definition(sheet: str | None) -> TableDefinition:
    return TableDefinition.model_validate({
        "sheet": sheet,
        "headerRow": None,
        "allowExtraColumns": True,
        "minRows": None,
        "maxRows": None,
        "columns": [],
    })


def _contract_for(path: Path) -> tuple[DefinitionContract, int]:
    base = {
        "schemaVersion": 1,
        "layout": "single",
        "ignoredSheets": [],
        "encoding": "auto",
        "tables": [_definition(None).model_dump()],
        "rules": [],
        "lookups": {},
    }
    provisional = DefinitionContract.model_validate(base)
    metadata = sniff_file(path, provisional)
    if metadata.extension not in {"xlsx", "xlsm", "xls", "xlsb"}:
        return provisional, 1
    try:
        workbook = fastexcel.read_excel(metadata.path)
    except (OSError, fastexcel.FastExcelError) as error:
        raise UnrecoverableFileError("The example workbook is corrupt or unsupported.") from error
    all_sheet_names = list(workbook.sheet_names)
    if not all_sheet_names:
        raise UnrecoverableFileError("The example workbook has no worksheets.")
    sheet_names = all_sheet_names[:MAX_EXAMPLE_SHEETS]
    contract = DefinitionContract.model_validate({
        **base,
        "layout": "sheets",
        "tables": [_definition(name).model_dump() for name in sheet_names],
    })
    return contract, len(all_sheet_names)


def _infer_type(values: list[str]) -> str:
    nonempty = [value.strip() for value in values if value.strip()]
    if not nonempty:
        return "string"
    if all(re.fullmatch(r"[+-]?\d+", value) for value in nonempty):
        return "integer"
    if all(re.fullmatch(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)", value) for value in nonempty):
        return "decimal"
    if all(_is_datetime(value) for value in nonempty):
        return "datetime"
    if all(_is_date(value) for value in nonempty):
        return "date"
    if all(value.casefold() in {"true", "false", "yes", "no", "1", "0"} for value in nonempty):
        return "boolean"
    return "string"


def _is_date(value: str) -> bool:
    try:
        date.fromisoformat(value)
        return True
    except ValueError:
        return False


def _is_datetime(value: str) -> bool:
    if _is_date(value):
        return False
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
        return True
    except ValueError:
        return False


def _format_number(value: float) -> str:
    return format(value, ".12g")


def _nice_ceiling(value: float) -> float:
    base = 10 ** math.floor(math.log10(value))
    ceiling = next(
        (multiplier * base for multiplier in (1, 2, 5, 10) if multiplier * base >= value),
        10 * base,
    )
    return float(ceiling)


def _looks_like_identifier(name: str) -> bool:
    words = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", name).lower()
    parts = [part for part in re.split(r"[^a-z0-9]+", words) if part]
    return bool(parts) and (parts[-1] in IDENTIFIER_WORDS or "".join(parts) in IDENTIFIER_WORDS)


def _bound(value: float) -> int | float:
    return int(value) if float(value).is_integer() else value


def _suggested_rules(name: str, kind: str, values: list[str], table: str | None) -> list[dict[str, Any]]:
    """Candidate RuleConfig values with the reason each was proposed. The caller assigns the execution order."""

    def rule(rule_name: str, rule_type: str, params: dict[str, Any], reason: str) -> dict[str, Any]:
        return {
            "rule": {
                "id": str(uuid4()),
                "name": rule_name,
                "description": "",
                "severity": "Error",
                "executionOrder": 1,
                "enabled": True,
                "table": table,
                "type": rule_type,
                "params": params,
            },
            "reason": reason,
        }

    rules: list[dict[str, Any]] = []
    filled = [value.strip() for value in values if value.strip()]
    if kind == "string":
        distinct = set(filled)
        if (
            1 < len(distinct) <= MAX_ENUM_VALUES
            and len(filled) >= len(distinct) * MIN_ROWS_PER_ENUM_VALUE
            and all(len(value) <= MAX_ENUM_VALUE_LENGTH and "," not in value for value in distinct)
        ):
            allowed = sorted(distinct, key=str.casefold)
            rules.append(rule(
                f"{name} allowed values",
                "enum",
                {"column": name, "values": allowed},
                f"{len(allowed)} distinct values repeat across {len(filled)} filled rows. "
                "Only values seen in the example would be allowed",
            ))
    if (
        kind in {"integer", "decimal"}
        and not re.fullmatch(r"Column\d+", name)
        and not _looks_like_identifier(name)
    ):
        try:
            numbers = [float(value) for value in filled]
        except ValueError:
            numbers = []
        if len(set(numbers)) >= 2:
            observed_min = min(numbers)
            observed_max = max(numbers)
            minimum = 0 if observed_min >= 0 else -_nice_ceiling(-observed_min)
            maximum = _nice_ceiling(observed_max) if observed_max > 0 else 0
            rules.append(rule(
                f"{name} range",
                "range",
                {"column": name, "min": _bound(minimum), "max": _bound(maximum)},
                f"Values in the example range from {_format_number(observed_min)} to "
                f"{_format_number(observed_max)}. The bounds are rounded out to leave headroom"
                f"{' and reject negative values' if minimum == 0 else ''}",
            ))
    return rules


def _summarize(table: ParsedTable) -> dict[str, Any]:
    frame = table.frame.head(MAX_ANALYZED_ROWS)
    columns: list[dict[str, Any]] = []
    suggested_rules: list[dict[str, Any]] = []
    warnings: list[str] = []
    if not table.source_columns:
        warnings.append("No header row was found.")
    blank_headers = sum(not header.strip() for header in table.source_columns)
    if blank_headers:
        warnings.append(f"{blank_headers} header cell(s) are blank and were named by position.")
    duplicate_headers: set[str] = set()
    seen: set[str] = set()
    for header in table.source_columns:
        normalized = header.strip().casefold()
        if normalized and normalized in seen:
            duplicate_headers.add(header.strip())
        elif normalized:
            seen.add(normalized)
    if duplicate_headers:
        warnings.append("Duplicate headers detected: " + ", ".join(sorted(duplicate_headers)) + ".")
    long_names = sum(len(header) > MAX_COLUMN_NAME_LENGTH for header in table.source_columns)
    if long_names:
        warnings.append(
            f"{long_names} column name(s) exceed {MAX_COLUMN_NAME_LENGTH} characters and must be shortened."
        )

    seen_columns: set[str] = set()
    for index, column in enumerate(table.source_columns):
        normalized = column.strip().casefold()
        if normalized and normalized in seen_columns:
            continue
        if normalized:
            seen_columns.add(normalized)
        actual = next(
            (
                name
                for name in frame.columns
                if normalized and name.strip().casefold() == normalized
            ),
            frame.columns[index] if index < len(frame.columns) and not normalized else None,
        )
        if actual is None:
            continue
        proposed_name = column.strip() or f"Column{index + 1}"
        values = ["" if value is None else str(value).strip() for value in frame.get_column(actual).to_list()]
        filled = sum(bool(value) for value in values)
        inferred_type = _infer_type(values)
        samples = list(dict.fromkeys(value for value in values if value))
        columns.append({
            "name": proposed_name,
            "type": inferred_type,
            "mustExist": True,
            "nullable": not (bool(values) and filled == len(values)),
            "filledRows": filled,
            "sampleValues": [
                value if len(value) <= MAX_SAMPLE_LENGTH else f"{value[:MAX_SAMPLE_LENGTH]}..."
                for value in samples[:MAX_SAMPLE_VALUES]
            ],
        })
        suggested_rules.extend(_suggested_rules(proposed_name, inferred_type, values, table.name or None))
    if frame.height == 0 and columns:
        warnings.append("There are no data rows below the header.")
    if table.frame.height > MAX_ANALYZED_ROWS:
        warnings.append(f"Only the first {MAX_ANALYZED_ROWS} data rows were analyzed.")
    return {
        "name": table.name or None,
        "headerRow": table.definition.headerRow,
        "rowsAnalyzed": frame.height,
        "truncated": table.frame.height > MAX_ANALYZED_ROWS,
        "columns": columns,
        "suggestedRules": suggested_rules,
        "warnings": warnings,
    }


def analyze_example(path: Path) -> dict[str, Any]:
    contract, workbook_sheet_count = _contract_for(path)
    metadata = sniff_file(path, contract)
    parsed = read_file(path, contract)
    sheets = [_summarize(table) for table in parsed.tables.values()]
    if not sheets or all(not sheet["columns"] for sheet in sheets):
        raise UnrecoverableFileError("The example file has no header row to build columns from.")
    warnings: list[str] = []
    if workbook_sheet_count > MAX_EXAMPLE_SHEETS:
        warnings.append(
            f"Only the first {MAX_EXAMPLE_SHEETS} of {workbook_sheet_count} worksheets were analyzed."
        )
    if any(sheet["truncated"] for sheet in sheets):
        warnings.append(f"Only the first {MAX_ANALYZED_ROWS} rows per table were analyzed.")
    return {"fileType": metadata.extension, "sheets": sheets[:MAX_EXAMPLE_SHEETS], "warnings": warnings}


def analyze_blob(container: str, name: str) -> dict[str, Any]:
    from tempfile import TemporaryDirectory

    with TemporaryDirectory(prefix="dq-example-") as directory:
        suffix = Path(name).suffix
        local_path = Path(directory) / f"example{suffix}"
        BlobStore().download_to_path(container, name, local_path)
        return analyze_example(local_path)
