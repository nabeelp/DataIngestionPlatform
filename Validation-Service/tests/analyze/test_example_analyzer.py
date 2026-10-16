from __future__ import annotations

from dq_engine.analyze.example_analyzer import analyze_example


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
    assert [rule["ruleType"] for rule in sheet["suggestedRules"]] == [
        "Range Check",
        "Enum Check",
    ]
    assert sheet["suggestedRules"][0]["expression"] == "Amount: 0..5"
    assert sheet["suggestedRules"][1]["expression"] == "Status: Closed, Open"


def test_example_analysis_does_not_suggest_ranges_for_identifier_columns(tmp_path) -> None:
    path = tmp_path / "identifiers.csv"
    path.write_text("CustomerId\n101\n102\n", encoding="utf-8")

    sheet = analyze_example(path)["sheets"][0]

    assert sheet["suggestedRules"] == []


def test_example_analysis_names_blank_headers_and_reports_warning(tmp_path) -> None:
    path = tmp_path / "blank-header.csv"
    path.write_text(",Amount\n1,2\n3,4\n", encoding="utf-8")

    sheet = analyze_example(path)["sheets"][0]

    assert [column["name"] for column in sheet["columns"]] == ["Column1", "Amount"]
    assert any("header cell(s) are blank" in warning for warning in sheet["warnings"])
    assert all(rule["name"] != "Column1 range" for rule in sheet["suggestedRules"])
