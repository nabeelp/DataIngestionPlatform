from __future__ import annotations

import argparse
import ctypes
import json
import os
import subprocess
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
    generate_xlsx,
    natural_language_benchmark_contract,
)
from dq_engine.config import get_settings
from dq_engine.engine import (
    ValidationOutcome,
    load_contract,
    validate_file,
    validate_parsed,
    write_outputs,
)
from dq_engine.io.models import UnrecoverableFileError
from dq_engine.io.readers import read_file
from dq_engine.telemetry import configure_telemetry, shutdown_telemetry, shutdown_telemetry_after_error

CSV_ENGINE_BUDGET_SECONDS = 1.5
XLSX_ENGINE_BUDGET_SECONDS = 3.0
XLSX_ROW_COUNT = 300_000
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
    reports: list[dict[str, Any]] = []
    if arguments.workload == "all":
        for workload in ("csv", "xlsx"):
            completed = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "dq_engine.cli",
                    "bench",
                    "--workload",
                    workload,
                    "--rows",
                    str(arguments.rows),
                    "--xlsx-rows",
                    str(arguments.xlsx_rows),
                ],
                capture_output=True,
                check=False,
                text=True,
            )
            if completed.returncode not in (0, 1):
                print(completed.stderr, file=sys.stderr)
                return completed.returncode
            child_report = json.loads(completed.stdout)
            reports.extend(child_report["workloads"])
        summary = {
            "workloads": reports,
            "peakRssBytes": max(int(report["peakRssBytes"]) for report in reports),
            "rssBudgetBytes": RSS_BUDGET_BYTES,
            "passedBudgets": all(bool(report["passedBudgets"]) for report in reports),
        }
        print(json.dumps(summary, indent=2))
        return 0 if summary["passedBudgets"] else 1

    with tempfile.TemporaryDirectory(prefix="dq-engine-bench-") as directory:
        contract = benchmark_contract()
        validation_date = date(2025, 1, 15)
        if arguments.workload in ("all", "csv"):
            path = Path(directory) / "benchmark.csv"
            generate(path, arguments.rows)
            engine_times: list[float] = []
            for _ in range(3):
                started = time.perf_counter()
                outcome = validate_file(path, contract, validation_date)
                engine_times.append(time.perf_counter() - started)
            elapsed_seconds = median(engine_times)
            parsed = read_file(path, contract)
            natural_language_contract = natural_language_benchmark_contract(contract)
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
            csv_budget_passed = (
                arguments.rows != 1_000_000
                or elapsed_seconds <= CSV_ENGINE_BUDGET_SECONDS
            )
            natural_language_budget_passed = (
                arguments.rows != 1_000_000 or natural_language_extra_ms <= 100
            )
            reports.append({
                "workload": "csv",
                "rows": arguments.rows,
                "fileBytes": path.stat().st_size,
                "rules": len(contract.rules),
                "engineSeconds": round(elapsed_seconds, 4),
                "engineRunSeconds": [round(value, 4) for value in engine_times],
                "engineBudgetSeconds": CSV_ENGINE_BUDGET_SECONDS,
                "naturalLanguageRowRuleBaselineMedianMs": round(baseline_median * 1000, 4),
                "naturalLanguageRowRuleMedianMs": round(natural_language_median * 1000, 4),
                "naturalLanguageRowRuleExtraMs": round(natural_language_extra_ms, 4),
                "naturalLanguageRowRuleBudgetMs": 100,
                "passedCsvBudgets": csv_budget_passed,
                "passedNaturalLanguageBudget": natural_language_budget_passed,
                "passedBudgets": csv_budget_passed and natural_language_budget_passed,
                "status": outcome.status,
                "issueCount": sum(check.issue_count for check in outcome.checks),
            })
        if arguments.workload in ("all", "xlsx"):
            path = Path(directory) / "benchmark.xlsx"
            generate_xlsx(path, arguments.xlsx_rows)
            engine_times = []
            for _ in range(3):
                started = time.perf_counter()
                outcome = validate_file(path, contract, validation_date)
                engine_times.append(time.perf_counter() - started)
            elapsed_seconds = median(engine_times)
            reports.append({
                "workload": "xlsx",
                "rows": arguments.xlsx_rows,
                "fileBytes": path.stat().st_size,
                "rules": len(contract.rules),
                "engineSeconds": round(elapsed_seconds, 4),
                "engineRunSeconds": [round(value, 4) for value in engine_times],
                "engineBudgetSeconds": XLSX_ENGINE_BUDGET_SECONDS,
                "passedEngineBudget": (
                    arguments.xlsx_rows != XLSX_ROW_COUNT
                    or elapsed_seconds <= XLSX_ENGINE_BUDGET_SECONDS
                ),
                "status": outcome.status,
                "issueCount": sum(check.issue_count for check in outcome.checks),
            })

        peak_rss = _peak_rss_bytes()
        for report in reports:
            report["peakRssBytes"] = peak_rss
            report["rssBudgetBytes"] = RSS_BUDGET_BYTES
            report["passedRssBudget"] = peak_rss <= RSS_BUDGET_BYTES
            report["passedBudgets"] = (
                bool(report["passedBudgets"]) if "passedBudgets" in report
                else bool(report["passedEngineBudget"])
            ) and peak_rss <= RSS_BUDGET_BYTES
    summary = {
        "workloads": reports,
        "peakRssBytes": peak_rss,
        "rssBudgetBytes": RSS_BUDGET_BYTES,
        "passedBudgets": all(bool(report["passedBudgets"]) for report in reports),
    }
    print(json.dumps(summary, indent=2))
    return 0 if summary["passedBudgets"] else 1


def _api_command(arguments: argparse.Namespace) -> None:
    configure_telemetry()
    try:
        import uvicorn

        settings = get_settings()
        uvicorn.run(
            "dq_engine.api.app:app",
            host=arguments.host or settings.api_host,
            port=arguments.port or settings.api_port,
            log_level=os.getenv("LOG_LEVEL", "info").casefold(),
        )
    except BaseException as error:
        shutdown_telemetry_after_error(error)
        raise
    else:
        shutdown_telemetry()


def _worker_command(arguments: argparse.Namespace) -> None:
    configure_telemetry("data-ingestion-worker")
    try:
        from dq_engine.messaging.servicebus import run_worker

        settings = get_settings()
        max_messages = arguments.max_messages
        if max_messages is None and settings.worker_mode.casefold() == "job":
            max_messages = settings.worker_max_messages
        run_worker(max_messages=max_messages, settings=settings)
    except BaseException as error:
        shutdown_telemetry_after_error(error)
        raise
    else:
        shutdown_telemetry()


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
    bench = commands.add_parser("bench", help="Run the §9 CSV, XLSX and Natural Language workloads.")
    bench.add_argument("--rows", type=int, default=1_000_000)
    bench.add_argument("--xlsx-rows", type=int, default=XLSX_ROW_COUNT)
    bench.add_argument("--workload", choices=("all", "csv", "xlsx"), default="all")
    bench.set_defaults(handler=_bench_command)
    api = commands.add_parser("api", help="Run the internal rules API.")
    api.add_argument("--host")
    api.add_argument("--port", type=int)
    api.set_defaults(handler=_api_command)
    worker = commands.add_parser("worker", help="Run the Azure Service Bus validation worker.")
    worker.add_argument("--max-messages", type=int)
    worker.set_defaults(handler=_worker_command)
    arguments = parser.parse_args()
    if arguments.command == "bench" and arguments.rows < 1:
        parser.error("--rows must be positive")
    if arguments.command == "bench" and arguments.xlsx_rows < 1:
        parser.error("--xlsx-rows must be positive")
    if arguments.command == "worker" and arguments.max_messages is not None and arguments.max_messages < 1:
        parser.error("--max-messages must be positive")
    raise SystemExit(arguments.handler(arguments))


if __name__ == "__main__":
    main()
