from __future__ import annotations

import argparse
from pathlib import Path

from dq_engine.benchmark import generate


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
