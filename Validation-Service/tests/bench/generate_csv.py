from __future__ import annotations

import argparse
import csv
from pathlib import Path

HEADERS = (
    "Id",
    "CustomerId",
    "OrderDate",
    "ShipDate",
    "Amount",
    "Discount",
    "Currency",
    "Status",
    "Country",
    "Email",
    "Quantity",
    "Reference",
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


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate the deterministic DQ engine benchmark CSV.")
    parser.add_argument("--output", type=Path, default=Path("orders-1m.csv"))
    parser.add_argument("--rows", type=int, default=1_000_000)
    arguments = parser.parse_args()
    if arguments.rows < 1:
        parser.error("--rows must be positive")
    generate(arguments.output, arguments.rows)


if __name__ == "__main__":
    main()
