from __future__ import annotations

from functools import lru_cache

from opentelemetry import metrics, trace
from opentelemetry.metrics import Histogram
from opentelemetry.trace import Tracer

from dq_engine.config import get_settings


@lru_cache(maxsize=1)
def configure_telemetry() -> tuple[Tracer, Histogram]:
    settings = get_settings()
    if settings.application_insights_connection_string:
        from azure.monitor.opentelemetry import configure_azure_monitor

        configure_azure_monitor(
            connection_string=settings.application_insights_connection_string,
            logger_name="dq_engine",
        )
    tracer = trace.get_tracer("dq_engine")
    meter = metrics.get_meter("dq_engine")
    rows_per_second = meter.create_histogram(
        "dq.rows_per_second",
        unit="rows/s",
        description="Validation throughput measured per uploaded file.",
    )
    return tracer, rows_per_second
