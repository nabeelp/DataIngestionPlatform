from __future__ import annotations

import atexit
import logging
import os
import re
import threading
import time
from functools import lru_cache
from queue import SimpleQueue
from typing import Any, Protocol, cast

from opentelemetry import metrics, trace
from opentelemetry._logs import get_logger_provider
from opentelemetry.metrics import Histogram
from opentelemetry.sdk._logs import LogRecordProcessor, ReadWriteLogRecord
from opentelemetry.sdk.trace import Event, ReadableSpan, SpanProcessor
from opentelemetry.trace import Link, Status, Tracer

from dq_engine.config import get_settings

_FLUSH_TIMEOUT_MILLIS = 5_000
_SHUTDOWN_TIMEOUT_SECONDS = 10.0
_DEFAULT_SAMPLING_RATIO = 1.0
_URL_PATTERN = re.compile(r"https?://[^\s\"'<>]+", re.IGNORECASE)
_SQL_PATTERN = re.compile(r"\b(select|insert|update|delete|merge|with)\b", re.IGNORECASE)
_WORKER_COMPLETED_PATTERN = re.compile(
    r"Validation completed upload_id=[^\s]+ rows=(\d+) checks=(\d+) status=(PASSED|WARNING|FAILED)"
)
_WORKER_START_PATTERN = re.compile(r"Starting validation worker mode=(local|job)")
_logger = logging.getLogger("dq_engine.telemetry")
_telemetry_enabled = False
_telemetry_shut_down = False
_telemetry_shutdown_failure: ExceptionGroup | None = None


class _FlushableProvider(Protocol):
    def force_flush(self, timeout_millis: int = _FLUSH_TIMEOUT_MILLIS) -> bool: ...

    def shutdown(self) -> None: ...


def _unregister_provider_atexit(provider: _FlushableProvider) -> None:
    for handler_name in ("_atexit_handler", "_at_exit_handler"):
        handler = getattr(provider, handler_name, None)
        if handler is not None:
            atexit.unregister(handler)


def _sensitive_attribute(key: str) -> bool:
    normalized = key.casefold().replace("-", "_")
    if any(
        part in normalized
        for part in (
            "url",
            "query",
            "sql",
            "statement",
            "authorization",
            "cookie",
            "token",
            "password",
            "secret",
            "cell",
            "file",
            "payload",
            "prompt",
            "completion",
            "instruction",
            "content",
            "body",
            "input",
            "output",
        )
    ):
        return True
    if normalized in {"error", "exception"} or normalized.endswith((".message", ".description", ".stacktrace")):
        return True
    if normalized.startswith("http.") and normalized.endswith((".target", ".uri")):
        return True
    if normalized.startswith("gen_ai."):
        return normalized not in {
            "gen_ai.operation.name",
            "gen_ai.provider.name",
            "gen_ai.request.model",
            "gen_ai.response.model",
            "gen_ai.usage.input_tokens",
            "gen_ai.usage.output_tokens",
        }
    return False


def _safe_events(events: Any) -> tuple[Event, ...]:
    return tuple(
        Event(
            name=_safe_span_name(event.name),
            attributes=_safe_attributes(event.attributes),
            timestamp=event.timestamp,
        )
        for event in events
    )


def _safe_attributes(attributes: Any) -> dict[str, Any]:
    if not attributes:
        return {}
    return {
        key: value
        for key, value in attributes.items()
        if not _sensitive_attribute(str(key))
        and not (
            isinstance(value, str)
            and (_URL_PATTERN.search(value) or _SQL_PATTERN.search(value))
        )
    }


def _safe_log_attributes(attributes: Any) -> dict[str, Any]:
    if not attributes:
        return {}
    safe: dict[str, Any] = {}
    for key, value in attributes.items():
        if (
            key in {"validation.rows", "validation.checks"}
            and isinstance(value, int)
            and not isinstance(value, bool)
            and value >= 0
        ):
            safe[key] = value
        elif (
            key == "validation.stage"
            and isinstance(value, str)
            and value in {"download", "sniff", "parse", "rules", "persist"}
        ):
            safe[key] = value
        elif key == "validation.status" and isinstance(value, str) and value in {"PASSED", "WARNING", "FAILED"}:
            safe[key] = value
    return safe


def _safe_span_name(name: str) -> str:
    if re.match(r"^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+/", name, re.IGNORECASE):
        return "HTTP request"
    if _URL_PATTERN.search(name) or "?" in name:
        return "http.request"
    if _SQL_PATTERN.search(name):
        return "db.operation"
    if re.search(r"\bgen_ai\b|\b(prompt|completion)\b|(?:Error|Exception):", name, re.IGNORECASE):
        return "operation"
    return name


class PrivacySpanProcessor(SpanProcessor):
    def on_end(self, span: ReadableSpan) -> None:
        span._name = _safe_span_name(span.name)
        span._attributes = _safe_attributes(span.attributes)
        span._events = _safe_events(span.events)
        span._links = tuple(Link(link.context, _safe_attributes(link.attributes)) for link in span.links)
        if span.status.description:
            span._status = Status(span.status.status_code)


class PrivacyLogRecordProcessor(LogRecordProcessor):
    def on_emit(self, log_record: ReadWriteLogRecord) -> None:
        record = log_record.log_record
        attributes = record.attributes or {}
        has_exception = any(str(key).startswith("exception.") for key in attributes)
        record.attributes = _safe_log_attributes(attributes)
        if has_exception or record.severity_number is not None and record.severity_number.value >= 17:
            record.body = "Error details redacted."
            return
        if not isinstance(record.body, str):
            record.body = "Log details redacted."
            return

        if record.body.startswith("Application Insights telemetry enabled"):
            record.body = "Application Insights telemetry enabled."
        elif record.body.startswith("Application Insights telemetry disabled"):
            record.body = "Application Insights telemetry disabled."
        elif _WORKER_START_PATTERN.fullmatch(record.body):
            record.body = record.body
        elif match := _WORKER_COMPLETED_PATTERN.fullmatch(record.body):
            rows, checks, status = match.groups()
            record.body = f"Validation completed rows={rows} checks={checks} status={status}"
        elif record.body == "Dead-lettered an invalid validation request message.":
            pass
        elif record.body.startswith("Completed permanent validation failure "):
            record.body = "Completed permanent validation failure."
        elif record.body.startswith("Abandoned transient validation failure "):
            record.body = "Abandoned transient validation failure."
        elif record.body.startswith("Service Bus worker connection or receive operation failed "):
            record.body = "Service Bus worker connection or receive operation failed."
        elif "shutdown" in record.body.casefold() and "telemetry" in record.body.casefold():
            record.body = "Telemetry shutdown encountered an error."
        else:
            record.body = "Application log details redacted."

    def shutdown(self) -> None:
        return None

    def force_flush(self, timeout_millis: int = _FLUSH_TIMEOUT_MILLIS) -> bool:
        return True


def _sampling_ratio() -> float:
    configured_ratio = os.getenv("APPLICATIONINSIGHTS_SAMPLING_RATIO")
    if configured_ratio is None:
        return _DEFAULT_SAMPLING_RATIO
    try:
        ratio = float(configured_ratio)
    except ValueError as error:
        raise ValueError("APPLICATIONINSIGHTS_SAMPLING_RATIO must be a number between 0 and 1.") from error
    if not 0 <= ratio <= 1:
        raise ValueError("APPLICATIONINSIGHTS_SAMPLING_RATIO must be a number between 0 and 1.")
    return ratio


def _configure_azure_monitor(connection_string: str, service_name: str, sampling_ratio: float) -> None:
    from azure.monitor.opentelemetry import configure_azure_monitor
    from opentelemetry.sdk.resources import Resource

    configure_azure_monitor(
        connection_string=connection_string,
        logger_name="dq_engine",
        resource=Resource.create({"service.name": service_name}),
        sampling_ratio=sampling_ratio,
        traces_per_second=None,
        span_processors=[PrivacySpanProcessor()],
        log_record_processors=[PrivacyLogRecordProcessor()],
    )


def _logging_level() -> int:
    configured_level = os.getenv("LOG_LEVEL", "INFO").upper()
    level = logging.getLevelName(configured_level)
    if not isinstance(level, int):
        raise ValueError(f"Unsupported LOG_LEVEL: {configured_level}")
    logging.getLogger().setLevel(level)
    return level


@lru_cache(maxsize=1)
def configure_telemetry(service_name: str = "data-ingestion-rules") -> tuple[Tracer, Histogram]:
    global _telemetry_enabled

    configured_service_name = os.getenv("OTEL_SERVICE_NAME") or service_name
    _logging_level()
    sampling_ratio = _sampling_ratio()
    settings = get_settings()
    connection_string = settings.application_insights_connection_string
    if connection_string and connection_string.strip():
        _configure_azure_monitor(
            connection_string,
            configured_service_name,
            sampling_ratio,
        )
        _telemetry_enabled = True
        _logger.info("Application Insights telemetry enabled service_name=%s", configured_service_name)
    else:
        _telemetry_enabled = False
        _logger.info(
            "Application Insights telemetry disabled service_name=%s reason=missing_connection_string",
            configured_service_name,
        )

    tracer = trace.get_tracer("dq_engine")
    meter = metrics.get_meter("dq_engine")
    rows_per_second = meter.create_histogram(
        "dq.rows_per_second",
        unit="rows/s",
        description="Validation throughput measured per uploaded file.",
    )
    return tracer, rows_per_second


def shutdown_telemetry() -> None:
    global _telemetry_shut_down, _telemetry_shutdown_failure

    if not _telemetry_enabled:
        return
    if _telemetry_shut_down:
        if _telemetry_shutdown_failure is not None:
            raise _telemetry_shutdown_failure
        return

    providers: tuple[tuple[str, _FlushableProvider], ...] = (
        ("metrics", cast(_FlushableProvider, metrics.get_meter_provider())),
        ("traces", cast(_FlushableProvider, trace.get_tracer_provider())),
        ("logs", cast(_FlushableProvider, get_logger_provider())),
    )
    failures: SimpleQueue[Exception] = SimpleQueue()
    finished: dict[str, threading.Event] = {name: threading.Event() for name, _ in providers}
    deadline = time.monotonic() + _SHUTDOWN_TIMEOUT_SECONDS

    for name, provider in providers:
        try:
            _unregister_provider_atexit(provider)
        except Exception as error:
            failures.put(RuntimeError(f"OpenTelemetry {name} atexit hook unregister raised {type(error).__name__}."))

    def flush_and_shutdown(name: str, provider: _FlushableProvider) -> None:
        try:
            try:
                if not provider.force_flush(timeout_millis=_FLUSH_TIMEOUT_MILLIS):
                    failures.put(RuntimeError(f"OpenTelemetry {name} provider did not flush within 5 seconds."))
            except Exception as error:
                failures.put(RuntimeError(f"OpenTelemetry {name} provider flush raised {type(error).__name__}."))
            try:
                provider.shutdown()
            except Exception as error:
                failures.put(RuntimeError(f"OpenTelemetry {name} provider shutdown raised {type(error).__name__}."))
        finally:
            finished[name].set()

    for name, provider in providers:
        threading.Thread(
            target=flush_and_shutdown,
            args=(name, provider),
            name=f"otel-{name}-shutdown",
            daemon=True,
        ).start()

    for name, _ in providers:
        remaining = max(0.0, deadline - time.monotonic())
        if not finished[name].wait(remaining):
            failures.put(RuntimeError(f"OpenTelemetry {name} flush and shutdown exceeded the 10-second limit."))

    _telemetry_shut_down = True
    failure_list: list[Exception] = []
    while not failures.empty():
        failure_list.append(failures.get())
    if failure_list:
        _telemetry_shutdown_failure = ExceptionGroup("OpenTelemetry shutdown failed.", failure_list)
        raise _telemetry_shutdown_failure


def shutdown_telemetry_after_error(application_error: BaseException) -> None:
    try:
        shutdown_telemetry()
    except Exception as shutdown_error:
        application_error.add_note(
            f"Telemetry shutdown also failed ({type(shutdown_error).__name__}); preserving the application error."
        )
        _logger.error(
            "Telemetry shutdown failed while preserving an application failure error_type=%s",
            type(shutdown_error).__name__,
        )
