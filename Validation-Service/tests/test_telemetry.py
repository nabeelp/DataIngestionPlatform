from __future__ import annotations

import logging
import subprocess
import sys
import threading
import time
from types import SimpleNamespace
from typing import Any

import azure.monitor.opentelemetry
import pytest
from opentelemetry.instrumentation.logging.handler import LoggingHandler
from opentelemetry.sdk._logs import LoggerProvider, LogRecordProcessor, ReadWriteLogRecord
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from dq_engine import telemetry


@pytest.fixture(autouse=True)
def reset_telemetry_state(monkeypatch: pytest.MonkeyPatch):
    original_level = logging.getLogger().level
    telemetry.configure_telemetry.cache_clear()
    monkeypatch.setattr(telemetry, "_telemetry_enabled", False)
    monkeypatch.setattr(telemetry, "_telemetry_shut_down", False)
    monkeypatch.setattr(telemetry, "_telemetry_shutdown_failure", None)
    yield
    telemetry.configure_telemetry.cache_clear()
    logging.getLogger().setLevel(original_level)


def test_missing_connection_string_disables_export_and_logs_diagnostic(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    monkeypatch.setattr(
        telemetry,
        "get_settings",
        lambda: SimpleNamespace(application_insights_connection_string=None),
    )
    monkeypatch.delenv("OTEL_SERVICE_NAME", raising=False)
    monkeypatch.setenv("LOG_LEVEL", "INFO")

    def fail_if_configured(*_: Any, **__: Any) -> None:
        raise AssertionError("Azure Monitor must not be configured without a connection string.")

    monkeypatch.setattr(telemetry, "_configure_azure_monitor", fail_if_configured)

    with caplog.at_level(logging.INFO):
        telemetry.configure_telemetry()

    assert "telemetry disabled service_name=data-ingestion-rules reason=missing_connection_string" in caplog.text
    assert telemetry._telemetry_enabled is False


def test_whitespace_connection_string_disables_export(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    monkeypatch.setattr(
        telemetry,
        "get_settings",
        lambda: SimpleNamespace(application_insights_connection_string="   "),
    )
    monkeypatch.setenv("LOG_LEVEL", "INFO")
    monkeypatch.setattr(
        telemetry,
        "_configure_azure_monitor",
        lambda *_args, **_kwargs: pytest.fail("Blank connection strings must not configure Azure Monitor."),
    )

    with caplog.at_level(logging.INFO):
        telemetry.configure_telemetry("data-ingestion-worker")

    assert "telemetry disabled service_name=data-ingestion-worker reason=missing_connection_string" in caplog.text
    assert telemetry._telemetry_enabled is False


def test_enabled_telemetry_uses_service_name_and_does_not_log_connection_string(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    connection_string = "InstrumentationKey=private-test-key"
    configured: list[tuple[str, str, float]] = []
    monkeypatch.setattr(
        telemetry,
        "get_settings",
        lambda: SimpleNamespace(application_insights_connection_string=connection_string),
    )
    monkeypatch.setattr(
        telemetry,
        "_configure_azure_monitor",
        lambda value, service, ratio: configured.append((value, service, ratio)),
    )
    monkeypatch.setenv("OTEL_SERVICE_NAME", "rules-override")
    monkeypatch.setenv("LOG_LEVEL", "DEBUG")
    monkeypatch.setenv("APPLICATIONINSIGHTS_SAMPLING_RATIO", "0.25")

    with caplog.at_level(logging.DEBUG):
        telemetry.configure_telemetry("data-ingestion-worker")
        assert logging.getLogger().level == logging.DEBUG

    assert configured == [(connection_string, "rules-override", 0.25)]
    assert "telemetry enabled service_name=rules-override" in caplog.text
    assert connection_string not in caplog.text
    assert telemetry._telemetry_enabled is True


@pytest.mark.parametrize("value", ["not-a-number", "-0.1", "1.1", "nan"])
def test_sampling_ratio_rejects_values_outside_its_range(
    monkeypatch: pytest.MonkeyPatch,
    value: str,
) -> None:
    monkeypatch.setenv("APPLICATIONINSIGHTS_SAMPLING_RATIO", value)

    with pytest.raises(ValueError, match="must be a number between 0 and 1"):
        telemetry._sampling_ratio()


def test_azure_monitor_uses_fixed_ratio_and_registers_privacy_processors(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}
    monkeypatch.setattr(
        azure.monitor.opentelemetry,
        "configure_azure_monitor",
        lambda **kwargs: captured.update(kwargs),
    )

    telemetry._configure_azure_monitor("InstrumentationKey=private-test-key", "rules-test", 0.4)

    assert captured["sampling_ratio"] == 0.4
    assert captured["traces_per_second"] is None
    assert len(captured["span_processors"]) == 1
    assert isinstance(captured["span_processors"][0], telemetry.PrivacySpanProcessor)
    assert len(captured["log_record_processors"]) == 1
    assert isinstance(captured["log_record_processors"][0], telemetry.PrivacyLogRecordProcessor)
    assert captured["resource"].attributes["service.name"] == "rules-test"


class _LogSink(LogRecordProcessor):
    def __init__(self) -> None:
        self.records: list[ReadWriteLogRecord] = []

    def on_emit(self, log_record: ReadWriteLogRecord) -> None:
        self.records.append(log_record)

    def shutdown(self) -> None:
        return None

    def force_flush(self, timeout_millis: int = 30_000) -> bool:
        return True


def test_local_otel_pipeline_strips_sensitive_data_before_sink() -> None:
    span_exporter = InMemorySpanExporter()
    tracer_provider = TracerProvider()
    tracer_provider.add_span_processor(telemetry.PrivacySpanProcessor())
    tracer_provider.add_span_processor(SimpleSpanProcessor(span_exporter))
    with tracer_provider.get_tracer("test").start_as_current_span(
        "GET https://example.test/private/path?token=secret"
    ) as span:
        span.set_attribute("validation.rows", 17)
        span.set_attribute("validation.stage", "rules")
        span.set_attribute("url.full", "https://example.test/private/path?token=secret")
        span.set_attribute("db.statement", "SELECT * FROM private_records")
        span.set_attribute("gen_ai.prompt", "private prompt")
        span.set_attribute("exception.message", "raw validation error")
        span.add_event(
            "exception",
            {
                "exception.type": "ValueError",
                "exception.message": "raw exception content",
                "exception.stacktrace": "private stack trace",
            },
        )
    with tracer_provider.get_tracer("test").start_as_current_span("SELECT * FROM private_records"):
        pass

    spans = span_exporter.get_finished_spans()
    assert len(spans) == 2
    http_span = next(span for span in spans if span.name == "http.request")
    sql_span = next(span for span in spans if span.name == "db.operation")
    assert http_span.attributes == {"validation.rows": 17, "validation.stage": "rules"}
    assert http_span.events[0].attributes == {"exception.type": "ValueError"}
    assert not sql_span.attributes
    tracer_provider.shutdown()

    log_provider = LoggerProvider()
    log_sink = _LogSink()
    log_provider.add_log_record_processor(telemetry.PrivacyLogRecordProcessor())
    log_provider.add_log_record_processor(log_sink)
    logger_name = "dq_engine.privacy_pipeline_test"
    python_logger = logging.getLogger(logger_name)
    handler = LoggingHandler(logger_provider=log_provider)
    previous_level = python_logger.level
    previous_propagate = python_logger.propagate
    previous_handlers = python_logger.handlers[:]
    python_logger.handlers.clear()
    python_logger.addHandler(handler)
    python_logger.setLevel(logging.DEBUG)
    python_logger.propagate = False
    try:
        python_logger.warning(
            "Request https://example.test/private?token=secret",
            extra={
                "db.statement": "SELECT * FROM private_records",
                "file.name": "customer-upload.xlsx",
                "validation.stage": "rules",
            },
        )
        python_logger.info("Uploaded file content: confidential cell value")
        python_logger.warning("GenAI prompt=private customer content")
        python_logger.warning(
            "Validation completed upload_id=private-upload rows=12 checks=3 status=PASSED"
        )
        python_logger.error("Failure contains a raw exception message.")
    finally:
        python_logger.removeHandler(handler)
        python_logger.handlers[:] = previous_handlers
        python_logger.setLevel(previous_level)
        python_logger.propagate = previous_propagate
        log_provider.shutdown()

    assert len(log_sink.records) == 5
    warning = log_sink.records[0].log_record
    assert warning.body == "Application log details redacted."
    assert warning.attributes == {"validation.stage": "rules"}
    assert log_sink.records[1].log_record.body == "Application log details redacted."
    assert log_sink.records[2].log_record.body == "Application log details redacted."
    assert log_sink.records[3].log_record.body == "Validation completed rows=12 checks=3 status=PASSED"
    error = log_sink.records[4].log_record
    assert error.body == "Error details redacted."


class _Provider:
    def __init__(self, name: str, events: list[str], flush_result: bool = True) -> None:
        self.name = name
        self.events = events
        self.flush_result = flush_result

    def force_flush(self, timeout_millis: int = 0) -> bool:
        assert timeout_millis == 5_000
        self.events.append(f"flush:{self.name}")
        return self.flush_result

    def shutdown(self) -> None:
        self.events.append(f"shutdown:{self.name}")


def test_shutdown_flushes_and_shuts_down_all_providers(monkeypatch: pytest.MonkeyPatch) -> None:
    events: list[str] = []
    providers = {name: _Provider(name, events) for name in ("metrics", "traces", "logs")}
    monkeypatch.setattr(telemetry.metrics, "get_meter_provider", lambda: providers["metrics"])
    monkeypatch.setattr(telemetry.trace, "get_tracer_provider", lambda: providers["traces"])
    monkeypatch.setattr(telemetry, "get_logger_provider", lambda: providers["logs"])
    monkeypatch.setattr(telemetry, "_telemetry_enabled", True)

    telemetry.shutdown_telemetry()

    assert all(
        events.index(f"flush:{name}") < events.index(f"shutdown:{name}")
        for name in ("metrics", "traces", "logs")
    )
    assert telemetry._telemetry_shut_down is True


def test_shutdown_surfaces_flush_failure_after_attempting_all_providers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[str] = []
    providers = {
        "metrics": _Provider("metrics", events, flush_result=False),
        "traces": _Provider("traces", events),
        "logs": _Provider("logs", events),
    }
    monkeypatch.setattr(telemetry.metrics, "get_meter_provider", lambda: providers["metrics"])
    monkeypatch.setattr(telemetry.trace, "get_tracer_provider", lambda: providers["traces"])
    monkeypatch.setattr(telemetry, "get_logger_provider", lambda: providers["logs"])
    monkeypatch.setattr(telemetry, "_telemetry_enabled", True)

    with pytest.raises(ExceptionGroup, match="OpenTelemetry shutdown failed"):
        telemetry.shutdown_telemetry()

    assert all(f"shutdown:{name}" in events for name in ("metrics", "traces", "logs"))
    with pytest.raises(ExceptionGroup, match="OpenTelemetry shutdown failed"):
        telemetry.shutdown_telemetry()


def test_shutdown_bounds_a_provider_that_hangs_during_shutdown(monkeypatch: pytest.MonkeyPatch) -> None:
    events: list[str] = []
    release_shutdown = threading.Event()
    providers = {name: _Provider(name, events) for name in ("metrics", "traces", "logs")}

    def block_shutdown() -> None:
        release_shutdown.wait()

    providers["metrics"].shutdown = block_shutdown
    monkeypatch.setattr(telemetry.metrics, "get_meter_provider", lambda: providers["metrics"])
    monkeypatch.setattr(telemetry.trace, "get_tracer_provider", lambda: providers["traces"])
    monkeypatch.setattr(telemetry, "get_logger_provider", lambda: providers["logs"])
    monkeypatch.setattr(telemetry, "_telemetry_enabled", True)
    monkeypatch.setattr(telemetry, "_SHUTDOWN_TIMEOUT_SECONDS", 0.05)

    started = time.monotonic()
    with pytest.raises(ExceptionGroup, match="OpenTelemetry shutdown failed"):
        telemetry.shutdown_telemetry()

    assert time.monotonic() - started < 1
    failure = telemetry._telemetry_shutdown_failure
    assert failure is not None
    assert any("metrics flush and shutdown exceeded" in str(error) for error in failure.exceptions)
    release_shutdown.set()


def test_subprocess_exit_is_bounded_when_installed_sdk_provider_shutdown_hangs() -> None:
    script = """
import logging
import threading

from opentelemetry import metrics, trace
from opentelemetry._logs import set_logger_provider
from opentelemetry.sdk._logs import LoggerProvider, LogRecordProcessor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.trace import SpanProcessor, TracerProvider

from dq_engine import telemetry

blocked = threading.Event()

class BlockingSpanProcessor(SpanProcessor):
    def shutdown(self):
        blocked.wait()

class BlockingLogProcessor(LogRecordProcessor):
    def on_emit(self, record):
        pass
    def shutdown(self):
        blocked.wait()
    def force_flush(self, timeout_millis=30000):
        return True

metrics.set_meter_provider(MeterProvider())
trace.set_tracer_provider(TracerProvider(active_span_processor=None))
trace.get_tracer_provider().add_span_processor(BlockingSpanProcessor())
logger_provider = LoggerProvider(multi_log_record_processor=None)
set_logger_provider(logger_provider)
logger_provider.add_log_record_processor(BlockingLogProcessor())
assert metrics.get_meter_provider()._atexit_handler is not None
assert trace.get_tracer_provider()._atexit_handler is not None
assert logger_provider._at_exit_handler is not None

telemetry._telemetry_enabled = True
telemetry._SHUTDOWN_TIMEOUT_SECONDS = 0.1
try:
    telemetry.shutdown_telemetry()
except ExceptionGroup:
    print("bounded shutdown surfaced provider failure", flush=True)
"""
    started = time.monotonic()
    result = subprocess.run(
        [sys.executable, "-c", script],
        capture_output=True,
        text=True,
        timeout=3,
        check=False,
    )

    assert time.monotonic() - started < 2.5
    assert result.returncode == 0, result.stderr
    assert "bounded shutdown surfaced provider failure" in result.stdout
