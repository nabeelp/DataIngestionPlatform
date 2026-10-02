from __future__ import annotations

import argparse
import ctypes
import json
import os
import sys
import tempfile
import time
from datetime import UTC, date, datetime
from pathlib import Path
from statistics import median
from typing import Any

from dq_engine.benchmark import (
    benchmark_contract,
    generate,
    natural_language_benchmark_contract,
)
from dq_engine.engine import (
    ValidationOutcome,
    load_contract,
    validate_file,
    validate_parsed,
    write_outputs,
)
from dq_engine.io.models import UnrecoverableFileError
from dq_engine.io.readers import read_file

CSV_ENGINE_BUDGET_SECONDS = 1.5
RSS_BUDGET_BYTES = 1_500 * 1024 * 1024


def _peak_rss_bytes() -> int:
    if os.name == "nt":
        class ProcessMemoryCounters(ctypes.Structure):
            _fields_ = [
                ("cb", ctypes.c_ulong),
                ("PageFaultCount", ctypes.c_ulong),
                ("PeakWorkingSetSize", ctypes.c_size_t),
                ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t),
                ("PeakPagefileUsage", ctypes.c_size_t),
            ]

        counters = ProcessMemoryCounters()
        counters.cb = ctypes.sizeof(counters)
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        psapi = ctypes.WinDLL("psapi", use_last_error=True)
        kernel32.GetCurrentProcess.restype = ctypes.c_void_p
        psapi.GetProcessMemoryInfo.argtypes = [
            ctypes.c_void_p,
            ctypes.POINTER(ProcessMemoryCounters),
            ctypes.c_ulong,
        ]
        psapi.GetProcessMemoryInfo.restype = ctypes.c_int
        process = kernel32.GetCurrentProcess()
        if not psapi.GetProcessMemoryInfo(process, ctypes.byref(counters), counters.cb):
            raise OSError("Unable to measure process peak memory.")
        return int(counters.PeakWorkingSetSize)

    resource_module = __import__("resource")
    return int(resource_module.getrusage(resource_module.RUSAGE_SELF).ru_maxrss * 1024)


def _outcome_summary(outcome: ValidationOutcome) -> dict[str, Any]:
    return {
        "status": outcome.status,
        "checks": len(outcome.checks),
        "issues": sum(check.issue_count for check in outcome.checks),
        "rows": sum(outcome.row_counts.values()),
    }


def _validate_command(arguments: argparse.Namespace) -> int:
    try:
        contract = load_contract(arguments.contract)
        validation_date = date.fromisoformat(arguments.validation_date) if arguments.validation_date else (
            datetime.now(UTC).date()
        )
        started = time.perf_counter()
        parsed = read_file(arguments.file, contract)
        outcome = validate_parsed(parsed, contract, validation_date)
    except (OSError, ValueError, UnrecoverableFileError) as error:
        print(json.dumps({"status": "ERROR", "error": str(error)}), file=sys.stderr)
        return 2
    elapsed_ms = int((time.perf_counter() - started) * 1000)
    if arguments.output_dir:
        write_outputs(parsed, outcome, arguments.output_dir)
    output = outcome.as_dict() if arguments.json else _outcome_summary(outcome)
    output["elapsedMs"] = elapsed_ms
    print(json.dumps(output, indent=2))
    return 1 if outcome.status == "FAILED" else 0


def _bench_command(arguments: argparse.Namespace) -> int:
    with tempfile.TemporaryDirectory(prefix="dq-engine-bench-") as directory:
        path = Path(directory) / "benchmark.csv"
        generate(path, arguments.rows)
        contract = benchmark_contract()
        started = time.perf_counter()
        outcome = validate_file(path, contract, date(2025, 1, 15))
        elapsed_seconds = time.perf_counter() - started
        parsed = read_file(path, contract)
        natural_language_contract = natural_language_benchmark_contract(contract)
        validation_date = date(2025, 1, 15)
        validate_parsed(parsed, contract, validation_date)
        validate_parsed(parsed, natural_language_contract, validation_date)
        baseline_times: list[float] = []
        natural_language_times: list[float] = []
        for _ in range(3):
            started = time.perf_counter()
            validate_parsed(parsed, contract, validation_date)
            baseline_times.append(time.perf_counter() - started)
            started = time.perf_counter()
            validate_parsed(parsed, natural_language_contract, validation_date)
            natural_language_times.append(time.perf_counter() - started)
        baseline_median = median(baseline_times)
        natural_language_median = median(natural_language_times)
        natural_language_extra_ms = (natural_language_median - baseline_median) * 1000
        peak_rss = _peak_rss_bytes()
        csv_budget_passed = (
            arguments.rows != 1_000_000
            or (elapsed_seconds <= CSV_ENGINE_BUDGET_SECONDS and peak_rss <= RSS_BUDGET_BYTES)
        )
        natural_language_budget_passed = (
            arguments.rows != 1_000_000 or natural_language_extra_ms <= 100
        )
        report = {
            "workload": "csv",
            "rows": arguments.rows,
            "fileBytes": path.stat().st_size,
            "rules": len(contract.rules),
            "engineSeconds": round(elapsed_seconds, 4),
            "peakRssBytes": peak_rss,
            "engineBudgetSeconds": CSV_ENGINE_BUDGET_SECONDS,
            "rssBudgetBytes": RSS_BUDGET_BYTES,
            "naturalLanguageRowRuleBaselineMedianMs": round(baseline_median * 1000, 4),
            "naturalLanguageRowRuleMedianMs": round(natural_language_median * 1000, 4),
            "naturalLanguageRowRuleExtraMs": round(natural_language_extra_ms, 4),
            "naturalLanguageRowRuleBudgetMs": 100,
            "passedCsvBudgets": csv_budget_passed,
            "passedNaturalLanguageBudget": natural_language_budget_passed,
            "passedBudgets": csv_budget_passed and natural_language_budget_passed,
            "status": outcome.status,
            "issueCount": sum(check.issue_count for check in outcome.checks),
        }
    print(json.dumps(report, indent=2))
    return 0 if report["passedBudgets"] else 1


def main() -> None:
    parser = argparse.ArgumentParser(prog="dq-engine")
    commands = parser.add_subparsers(dest="command", required=True)
    validate = commands.add_parser("validate", help="Validate a file against a definition contract.")
    validate.add_argument("file", type=Path)
    validate.add_argument("--contract", type=Path, required=True)
    validate.add_argument("--validation-date")
    validate.add_argument("--output-dir", type=Path)
    validate.add_argument("--json", action="store_true")
    validate.set_defaults(handler=_validate_command)
    bench = commands.add_parser("bench", help="Run the 18-rule CSV performance workload.")
    bench.add_argument("--rows", type=int, default=1_000_000)
    bench.set_defaults(handler=_bench_command)
    arguments = parser.parse_args()
    if arguments.command == "bench" and arguments.rows < 1:
        parser.error("--rows must be positive")
    raise SystemExit(arguments.handler(arguments))


if __name__ == "__main__":
    main()
