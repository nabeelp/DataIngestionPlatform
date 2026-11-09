from __future__ import annotations

from dq_engine.analyze.example_analyzer import analyze_example
from dq_engine.contracts.models import DefinitionContract


def test_example_analysis_suggests_enum_and_range_rules(tmp_path) -> None:
    path = tmp_path / "orders.csv"
    path.write_text(
        "Amount,Status,CustomerId\n"
        "1,Open,001\n"
        "2,Open,002\n"
        "3,Closed,003\n"
        "4,Closed,004\n",
        encoding="utf-8",
    )

    analysis = analyze_example(path)

    sheet = analysis["sheets"][0]
    assert [column["type"] for column in sheet["columns"]] == ["integer", "string", "integer"]
    assert all(column["mustExist"] and not column["nullable"] for column in sheet["columns"])
    assert "required" not in sheet["columns"][0]
    rules = [suggestion["rule"] for suggestion in sheet["suggestedRules"]]
    assert [rule["type"] for rule in rules] == ["range", "enum"]
    assert rules[0]["params"] == {"column": "Amount", "min": 0, "max": 5}
    assert rules[1]["params"] == {"column": "Status", "values": ["Closed", "Open"]}
    for rule in rules:
        assert rule["severity"] == "Error" and rule["enabled"] is True and rule["table"] is None
        assert rule["id"] and rule["description"] == ""
    assert all(suggestion["reason"] for suggestion in sheet["suggestedRules"])
    # Every suggestion is a valid RuleConfig for the definition it was derived from.
    contract = {
        "schemaVersion": 1,
        "layout": "single",
        "ignoredSheets": [],
        "encoding": "auto",
        "tables": [{
            "sheet": None,
            "headerRow": None,
            "allowExtraColumns": True,
            "minRows": None,
            "maxRows": None,
            "columns": [
                {key: column[key] for key in ("name", "type", "mustExist", "nullable")}
                for column in sheet["columns"]
            ],
        }],
        "rules": rules,
        "lookups": {},
    }
    DefinitionContract.model_validate(contract)


def test_example_analysis_does_not_suggest_ranges_for_identifier_columns(tmp_path) -> None:
    path = tmp_path / "identifiers.csv"
    path.write_text("CustomerId\n101\n102\n", encoding="utf-8")

    sheet = analyze_example(path)["sheets"][0]

    assert sheet["suggestedRules"] == []


def test_example_analysis_marks_columns_with_empty_cells_as_nullable(tmp_path) -> None:
    path = tmp_path / "gaps.csv"
    path.write_text("Name,Note\nA,x\nB,\n", encoding="utf-8")

    columns = analyze_example(path)["sheets"][0]["columns"]

    assert [(column["name"], column["nullable"]) for column in columns] == [("Name", False), ("Note", True)]


def test_example_analysis_scopes_suggestions_to_their_sheet() -> None:
    from pathlib import Path

    customers = Path(__file__).resolve().parents[3] / "samples" / "01-single-table" / "customers"
    workbook = customers / "customers_valid.xlsx"

    sheets = analyze_example(workbook)["sheets"]

    suggestions = [
        (sheet["name"], suggestion["rule"]["table"])
        for sheet in sheets
        for suggestion in sheet["suggestedRules"]
    ]
    assert suggestions
    assert all(sheet_name is not None and sheet_name == table for sheet_name, table in suggestions)


def test_example_analysis_names_blank_headers_and_reports_warning(tmp_path) -> None:
    path = tmp_path / "blank-header.csv"
    path.write_text(",Amount\n1,2\n3,4\n", encoding="utf-8")

    sheet = analyze_example(path)["sheets"][0]

    assert [column["name"] for column in sheet["columns"]] == ["Column1", "Amount"]
    assert any("header cell(s) are blank" in warning for warning in sheet["warnings"])
    assert all(suggestion["rule"]["name"] != "Column1 range" for suggestion in sheet["suggestedRules"])
