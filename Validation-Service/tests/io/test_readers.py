from __future__ import annotations

import json
from pathlib import Path

import pytest

from dq_engine.contracts.models import DefinitionContract
from dq_engine.io.models import UnrecoverableFileError
from dq_engine.io.readers import read_file
from dq_engine.io.sniff import sniff_file

ROOT = Path(__file__).resolve().parents[3]


def contract(
    *,
    layout: str = "single",
    sheet: str | None = None,
    header_row: int | None = None,
    columns: list[dict[str, object]] | None = None,
) -> DefinitionContract:
    payload = {
        "schemaVersion": 1,
        "layout": layout,
        "ignoredSheets": [],
        "encoding": "auto",
        "tables": [{
            "sheet": sheet,
            "headerRow": header_row,
            "allowExtraColumns": True,
            "minRows": None,
            "maxRows": None,
            "columns": columns or [],
        }],
        "rules": [],
        "lookups": {},
    }
    return DefinitionContract.model_validate(payload)


def test_sniff_detects_utf8_bom_and_semicolon_delimiter(tmp_path: Path) -> None:
    path = tmp_path / "records.csv"
    path.write_bytes("\ufeffName;City\nAda;London\n".encode("utf-8"))

    metadata = sniff_file(path, contract())

    assert metadata.encoding == "utf-8-sig"
    assert metadata.delimiter == ";"


def test_sniff_transcodes_utf16_bom_csv(tmp_path: Path) -> None:
    path = tmp_path / "records.csv"
    path.write_bytes("Name,City\nAda,London\n".encode("utf-16"))

    parsed = read_file(path, contract())

    assert parsed.tables[""].frame.columns == ["Name", "City"]
    assert parsed.tables[""].frame.row(0) == ("Ada", "London")


def test_sniff_rejects_mismatched_extension(tmp_path: Path) -> None:
    path = tmp_path / "renamed.xlsx"
    path.write_text("Name,City\nAda,London\n", encoding="utf-8")

    with pytest.raises(UnrecoverableFileError, match="signature"):
        sniff_file(path, contract())


def test_A3_duplicate_and_empty_headers_report_positions(tmp_path: Path) -> None:
    path = tmp_path / "headers.csv"
    path.write_text("Name,name, ,City\nAda,Ada,x,London\n", encoding="utf-8")

    parsed = read_file(path, contract())

    assert [issue.code for issue in parsed.structural_issues] == ["duplicate_header", "empty_header"]
    assert [issue.column for issue in parsed.structural_issues] == ["name", "3"]


def test_A4_ragged_rows_report_physical_line_and_field_counts(tmp_path: Path) -> None:
    path = tmp_path / "ragged.csv"
    path.write_text('A,B\n1,2\n"multi\nline",3\n4,5,6\n7,8\n', encoding="utf-8")

    parsed = read_file(path, contract())

    assert len(parsed.structural_issues) == 1
    issue = parsed.structural_issues[0]
    assert issue.code == "ragged_row"
    assert issue.row == 5
    assert issue.message == "Expected 2 fields but found 3."
    assert parsed.tables[""].frame.height == 3
    assert parsed.tables[""].row_numbers == [2, 3, 6]


def test_A1_empty_csv_has_no_detected_headers(tmp_path: Path) -> None:
    path = tmp_path / "empty.csv"
    path.write_bytes(b"")

    parsed = read_file(path, contract(columns=[{
        "name": "RequiredId",
        "type": "string",
        "mustExist": True,
        "nullable": False,
    }]))

    assert parsed.tables[""].source_columns == []
    assert parsed.tables[""].frame.height == 0
    assert parsed.tables[""].frame.columns == ["RequiredId"]


def test_excel_reader_honours_header_row_and_hidden_table_sheet() -> None:
    source = ROOT / "samples" / "02-sheet-tables" / "finance" / "finance_valid_hidden_table_sheet.xlsx"
    payload = json.loads((ROOT / "samples" / "definitions" / "sample_definitions.json").read_text(encoding="utf-8"))
    finance = next(item for item in payload.values() if item["name"] == "Sample - Finance Workbook")
    # The shared definition JSON is the legacy sample shape; the contract below targets the hidden table explicitly.
    finance_contract = contract(layout="sheets", sheet="Payments", columns=[])
    finance_contract.tables[0].headerRow = 1

    parsed = read_file(source, finance_contract)

    assert "Payments" in parsed.tables
    assert parsed.tables["Payments"].frame.height > 0
    assert finance["tables"]
