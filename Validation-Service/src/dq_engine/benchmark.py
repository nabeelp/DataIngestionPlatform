from __future__ import annotations

import csv
from pathlib import Path

from dq_engine.contracts.models import DefinitionContract, NaturalLanguageRule

HEADERS = (
    "Id", "CustomerId", "OrderDate", "ShipDate", "Amount", "Discount",
    "Currency", "Status", "Country", "Email", "Quantity", "Reference",
)


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

    add("columnsPresent", "Required headers", {"columns": ["Id", "Amount", "Email"]})
    add("required", "Order identifier", {"columns": ["Id"]})
    add("required", "Customer identifier", {"columns": ["CustomerId"]})
    add("type", "Order date", {"column": "OrderDate", "dataType": "date"})
    add("type", "Amount number", {"column": "Amount", "dataType": "decimal"})
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
            "columns": [],
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
