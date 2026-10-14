from __future__ import annotations

import csv
import hashlib
import io
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZIP_DEFLATED, ZipFile

from dq_engine.contracts.models import DefinitionContract, NaturalLanguageRule

HEADERS = (
    "Id", "CustomerId", "OrderDate", "ShipDate", "Amount", "Discount",
    "Currency", "Status", "Country", "Email", "Quantity", "Reference",
)
XLSX_HEADERS = HEADERS


def row_for(index: int) -> tuple[str, ...]:
    invalid = index % 200 == 0
    return (
        f"ORD-{index:07d}",
        f"CUST-{index % 100_000:06d}",
        "2025-01-15" if not invalid else "2025-02-30",
        "2025-01-18",
        str((index % 10_000) + 10),
        str((index % 10) / 10 if not invalid else 99),
        ("USD", "EUR", "GBP", "ZAR")[index % 4] if not invalid else "XXX",
        ("Paid", "Pending", "Refunded", "Failed")[index % 4],
        ("US", "CA", "GB", "ZA")[index % 4],
        f"customer{index % 100_000}@example.test",
        str((index % 20) + 1),
        f"REF-{index:07d}",
    )


def generate(path: Path, row_count: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as output:
        writer = csv.writer(output, lineterminator="\n")
        writer.writerow(HEADERS)
        writer.writerows(row_for(index) for index in range(row_count))


def generate_xlsx(path: Path, row_count: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    column_names = (
        "A", "B", "C", "D", "E", "F",
        "G", "H", "I", "J", "K", "L",
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '</Types>'
    )
    package_relationships = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
        'Target="xl/workbook.xml"/>'
        '</Relationships>'
    )
    workbook = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheets><sheet name="Orders" sheetId="1" r:id="rId1"/></sheets></workbook>'
    )
    workbook_relationships = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
        'Target="worksheets/sheet1.xml"/>'
        '</Relationships>'
    )

    with ZipFile(path, "w", compression=ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", package_relationships)
        archive.writestr("xl/workbook.xml", workbook)
        archive.writestr("xl/_rels/workbook.xml.rels", workbook_relationships)
        with archive.open("xl/worksheets/sheet1.xml", "w") as worksheet:
            with io.TextIOWrapper(worksheet, encoding="utf-8", newline="", write_through=True) as output:
                output.write(
                    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                    f'<dimension ref="A1:L{row_count + 1}"/><sheetData>'
                )

                def write_row(
                    row_number: int,
                    values: tuple[str, ...],
                    numeric_columns: frozenset[int] = frozenset(),
                ) -> None:
                    output.write(f'<row r="{row_number}">')
                    for index, (column, value) in enumerate(zip(column_names, values, strict=True)):
                        if index in numeric_columns:
                            output.write(f'<c r="{column}{row_number}"><v>{escape(value)}</v></c>')
                        else:
                            output.write(
                                f'<c r="{column}{row_number}" t="inlineStr"><is><t>'
                                f'{escape(value)}</t></is></c>'
                            )
                    output.write("</row>")

                write_row(1, XLSX_HEADERS)
                for index in range(row_count):
                    values = list(row_for(index))
                    values[1] = (
                        f"CUST-{index % 100_000:06d}-"
                        f"{hashlib.sha512(f'dq-benchmark:{index}'.encode()).hexdigest()[:124]}"
                    )
                    write_row(
                        index + 2,
                        tuple(values),
                        frozenset({4, 5, 10}),
                    )
                output.write("</sheetData></worksheet>")


def _column(name: str, data_type: str, *, nullable: bool = True) -> dict[str, object]:
    return {"name": name, "type": data_type, "mustExist": True, "nullable": nullable}


def benchmark_contract() -> DefinitionContract:
    rules: list[dict[str, object]] = []

    def add(rule_type: str, name: str, params: dict[str, object]) -> None:
        rules.append({
            "id": f"bench-{len(rules) + 1:02}",
            "name": name,
            "description": name,
            "severity": "Error",
            "executionOrder": len(rules),
            "enabled": True,
            "table": None,
            "type": rule_type,
            "params": params,
        })

    add("enum", "Currency code", {"column": "Currency", "values": ["USD", "EUR", "GBP", "ZAR"]})
    add("enum", "Order status", {"column": "Status", "values": ["Paid", "Pending", "Refunded", "Failed"]})
    add("range", "Amount range", {"column": "Amount", "min": 0})
    add("range", "Discount range", {"column": "Discount", "min": 0, "max": 1})
    add("pattern", "Email shape", {
        "column": "Email",
        "pattern": r"^[^@]+@[^@]+\.[^@]+$",
    })
    add("length", "Reference length", {"column": "Reference", "min": 11, "max": 11})
    add("unique", "Order identifier uniqueness", {"columns": ["Id"]})
    add("lookup", "Country lookup", {"column": "Country", "lookupId": "countries"})
    add("dateRange", "Ship date", {"column": "ShipDate", "min": "2025-01-01"})
    add("conditionalRequired", "Refund discount", {
        "columns": ["Discount"],
        "when": {"column": "Status", "op": "eq", "value": "Refunded"},
    })
    add("compare", "Ship after order", {
        "left": "ShipDate", "op": "ge", "right": "OrderDate", "as": "date",
    })
    add("rowCount", "Minimum rows", {"min": 1})
    add("aggregate", "Positive total amount", {"column": "Amount", "fn": "sum", "min": 0})

    return DefinitionContract.model_validate({
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
                _column("Id", "string", nullable=False),
                _column("CustomerId", "string", nullable=False),
                _column("OrderDate", "date"),
                _column("Amount", "decimal"),
                _column("Email", "string"),
            ],
        }],
        "rules": rules,
        "lookups": {
            "countries": {"name": "countries", "values": ["US", "CA", "GB", "ZA"]},
        },
    })


def natural_language_benchmark_contract(contract: DefinitionContract) -> DefinitionContract:
    rule = NaturalLanguageRule.model_validate({
        "id": "bench-natural-language",
        "name": "Natural Language row-rule overhead",
        "description": "Measure the incremental cost of one guarded row predicate.",
        "severity": "Error",
        "executionOrder": len(contract.rules),
        "enabled": True,
        "table": None,
        "type": "naturalLanguage",
        "params": {
            "request": "Amount must be nonnegative.",
            "explanation": "Fails rows where Amount is negative.",
            "mode": "row",
            "failWhen": "TRY_CAST(Amount AS DOUBLE) < 0",
            "query": None,
            "message": "Amount must be nonnegative.",
            "columns": {"": ["Amount"]},
            "examples": [],
            "provenance": {
                "model": "benchmark",
                "responseId": "benchmark",
                "promptSha256": "0" * 64,
                "createdAt": "2025-01-15T00:00:00Z",
            },
        },
    })
    return contract.model_copy(update={"rules": [*contract.rules, rule]})
