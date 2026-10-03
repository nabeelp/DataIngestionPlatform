from __future__ import annotations

import hashlib
import hmac
import logging
import tempfile
import time
from collections.abc import Callable
from datetime import UTC, date, datetime
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any, Literal

from azure.core.exceptions import ResourceNotFoundError
from azure.identity import DefaultAzureCredential
from azure.servicebus import AutoLockRenewer, ServiceBusClient, ServiceBusMessage
from azure.servicebus.exceptions import ServiceBusError
from pydantic import ValidationError

from dq_engine.config import Settings, get_settings
from dq_engine.contracts.models import (
    DefinitionContract,
    ValidationEvent,
    ValidationRequest,
    ValidationSummary,
)
from dq_engine.engine import validate_parsed, write_outputs
from dq_engine.io.blob import BlobStore
from dq_engine.io.models import UnrecoverableFileError
from dq_engine.io.readers import read_file
from dq_engine.persist import sql
from dq_engine.rules.base import RuleConfigurationError
from dq_engine.telemetry import configure_telemetry

logger = logging.getLogger("dq_engine.worker")
_TRACER, _ROWS_PER_SECOND = configure_telemetry()


def _body_bytes(body: Any) -> bytes:
    if isinstance(body, bytes):
        return body
    if isinstance(body, str):
        return body.encode("utf-8")
    return b"".join(bytes(chunk) for chunk in body)


def _decode_request(body: Any) -> ValidationRequest:
    try:
        return ValidationRequest.model_validate_json(_body_bytes(body))
    except (UnicodeDecodeError, ValueError) as error:
        raise sql.PermanentJobError("The validation request message is invalid.") from error


def _validation_date(value: Any, requested_at: str) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    normalized = requested_at.replace("Z", "+00:00")
    try:
        requested = datetime.fromisoformat(normalized)
    except ValueError as error:
        raise sql.PermanentJobError("The validation request timestamp is invalid.") from error
    if requested.tzinfo is None:
        raise sql.PermanentJobError("The validation request timestamp must include a UTC offset.")
    return requested.astimezone(UTC).date()


def _engine_version() -> str:
    try:
        return version("dq-engine")
    except PackageNotFoundError:
        return "0.1.0"


class ProgressPublisher:
    def __init__(self, send_event: Callable[[ValidationEvent], None], upload_id: str) -> None:
        self._send_event = send_event
        self._upload_id = upload_id
        self._last_sent = 0.0

    def publish(
        self,
        stage: Literal["download", "sniff", "parse", "rules", "persist"],
        percent: int,
        *,
        force: bool = False,
    ) -> None:
        now = time.monotonic()
        if not force and now - self._last_sent < 1:
            return
        event = ValidationEvent(
            schemaVersion=1,
            uploadId=self._upload_id,
            type="progress",
            stage=stage,
            percent=percent,
        )
        self._send_event(event)
        self._last_sent = now


def process_validation_request(
    request: ValidationRequest,
    send_event: Callable[[ValidationEvent], None],
    *,
    blob_store: BlobStore | None = None,
) -> dict[str, int]:
    started_at = datetime.now(UTC)
    progress = ProgressPublisher(send_event, request.uploadId)
    with _TRACER.start_as_current_span("validation") as root_span:
        root_span.set_attribute("upload.id", request.uploadId)
        try:
            with _TRACER.start_as_current_span("load_pinned_definition"):
                upload, contract_payload = sql.load_job(request)
            contract = DefinitionContract.model_validate(contract_payload)
            if request.blob.container != get_settings().uploads_container:
                raise sql.PermanentJobError("The upload references an unsupported blob container.")
            validation_date = _validation_date(upload["ValidationDate"], request.requestedAt)
            sql.mark_started(request.uploadId, started_at)
            progress.publish("download", 10, force=True)

            store = blob_store or BlobStore()
            with tempfile.TemporaryDirectory(prefix="dq-validation-") as directory:
                path = Path(directory) / f"upload.{request.fileType}"
                with _TRACER.start_as_current_span("download_blob"):
                    try:
                        store.download_to_path(request.blob.container, request.blob.name, path)
                    except ResourceNotFoundError as error:
                        raise UnrecoverableFileError("The uploaded blob was not found.") from error
                    with path.open("rb") as source:
                        file_sha256 = hashlib.file_digest(source, "sha256").hexdigest()
                    expected_sha256 = upload.get("FileSha256")
                    if expected_sha256 and not hmac.compare_digest(
                        str(expected_sha256).strip().casefold(),
                        file_sha256.casefold(),
                    ):
                        raise UnrecoverableFileError("The uploaded file checksum does not match its record.")

                progress.publish("sniff", 25)
                with _TRACER.start_as_current_span("parse_file"):
                    parsed = read_file(path, contract)
                progress.publish("parse", 45)
                with _TRACER.start_as_current_span("evaluate_rules") as rules_span:
                    engine_started = time.perf_counter()
                    outcome = validate_parsed(parsed, contract, validation_date)
                    engine_seconds = time.perf_counter() - engine_started
                    row_count = sum(outcome.row_counts.values())
                    rules_span.set_attribute("validation.rows", row_count)
                    if engine_seconds > 0:
                        _ROWS_PER_SECOND.record(row_count / engine_seconds)
                progress.publish("rules", 75)

                output_directory = Path(directory) / "outputs"
                write_outputs(parsed, outcome, output_directory)
                report_blob_name = f"{request.uploadId}/issues.csv"
                parquet_prefix = f"parquet/{request.uploadId}/"
                with _TRACER.start_as_current_span("write_artifacts"):
                    store.upload_file(
                        get_settings().reports_container,
                        report_blob_name,
                        output_directory / "issues.csv",
                        "text/csv; charset=utf-8",
                    )
                    parquet_files = sorted(output_directory.glob("table-*.parquet"))
                    for parquet_path in parquet_files:
                        store.upload_file(
                            get_settings().staging_container,
                            parquet_prefix + parquet_path.name,
                            parquet_path,
                            "application/vnd.apache.parquet",
                        )
                progress.publish("persist", 90)

                with _TRACER.start_as_current_span("persist_results"):
                    counts = sql.persist_success(
                        request.uploadId,
                        outcome,
                        contract,
                        started_at,
                        validation_date,
                        parsed.metadata.encoding,
                        file_sha256,
                        report_blob_name,
                        parquet_prefix,
                        _engine_version(),
                        len(parsed.tables),
                    )

        except (sql.PermanentJobError, UnrecoverableFileError, RuleConfigurationError) as error:
            reason = str(error)
            sql.persist_failure(request.uploadId, reason)
            failed = ValidationEvent(
                schemaVersion=1,
                uploadId=request.uploadId,
                type="failed",
                stage="persist",
                percent=100,
                error=reason,
            )
            send_event(failed)
            raise
        except ValidationError as error:
            sql.persist_failure(request.uploadId, "The pinned definition contract is invalid.")
            send_event(ValidationEvent(
                schemaVersion=1,
                uploadId=request.uploadId,
                type="failed",
                stage="persist",
                percent=100,
                error="The pinned definition contract is invalid.",
            ))
            raise sql.PermanentJobError("The pinned definition contract is invalid.") from error

        summary_status: Literal["PASSED", "WARNING", "FAILED"]
        if outcome.status == "PASSED":
            summary_status = "PASSED"
        elif outcome.status == "WARNING":
            summary_status = "WARNING"
        else:
            summary_status = "FAILED"
        summary = ValidationSummary(
            status=summary_status,
            passed=int(counts["passed"]),
            failed=int(counts["failed"]),
            warnings=int(counts["warnings"]),
            rowCount=int(counts["rowCount"]),
        )
        progress.publish("persist", 100, force=True)
        completed = ValidationEvent(
            schemaVersion=1,
            uploadId=request.uploadId,
            type="completed",
            stage="persist",
            percent=100,
            summary=summary,
        )
        send_event(completed)
        root_span.set_attribute("validation.status", summary_status)
        root_span.set_attribute("validation.rows", int(counts["rowCount"]))
        logger.info(
            "Validation completed upload_id=%s rows=%d checks=%d status=%s",
            request.uploadId,
            int(counts["rowCount"]),
            len(outcome.checks),
            summary_status,
        )
        return counts


def _send_event(sender: Any, request: ValidationRequest, event: ValidationEvent) -> None:
    message = ServiceBusMessage(
        event.model_dump_json(exclude_none=True),
        correlation_id=request.correlationId,
        subject=event.type,
        content_type="application/json",
    )
    sender.send_messages(message)


def _service_bus_client(settings: Settings) -> ServiceBusClient:
    if settings.service_bus_connection_string:
        return ServiceBusClient.from_connection_string(settings.service_bus_connection_string)
    if settings.service_bus_namespace:
        return ServiceBusClient(
            fully_qualified_namespace=settings.service_bus_namespace,
            credential=DefaultAzureCredential(),
        )
    raise RuntimeError("Service Bus connection settings are not configured.")


def _handle_received(receiver: Any, sender: Any, message: Any, renewer: AutoLockRenewer) -> None:
    try:
        request = _decode_request(message.body)
    except sql.PermanentJobError:
        receiver.dead_letter_message(message, reason="InvalidValidationRequest")
        logger.warning("Dead-lettered an invalid validation request message.")
        return
    renewer.register(receiver, message, max_lock_renewal_duration=3600)
    try:
        process_validation_request(
            request,
            lambda event: _send_event(sender, request, event),
        )
    except (sql.PermanentJobError, UnrecoverableFileError, RuleConfigurationError):
        receiver.complete_message(message)
        logger.warning("Completed permanent validation failure upload_id=%s", request.uploadId)
    except Exception as error:
        receiver.abandon_message(message)
        logger.error(
            "Abandoned transient validation failure upload_id=%s error_type=%s",
            request.uploadId,
            type(error).__name__,
        )
    else:
        receiver.complete_message(message)


def run_worker(
    max_messages: int | None = None,
    *,
    settings: Settings | None = None,
) -> None:
    configuration = settings or get_settings()
    logger.info("Starting validation worker mode=%s", configuration.worker_mode)
    client = _service_bus_client(configuration)
    processed = 0
    try:
        with client:
            with client.get_queue_receiver(
                queue_name=configuration.validation_queue,
                max_wait_time=5,
            ) as receiver, client.get_topic_sender(
                topic_name=configuration.events_topic,
            ) as sender, AutoLockRenewer(max_lock_renewal_duration=3600) as renewer:
                while max_messages is None or processed < max_messages:
                    messages = receiver.receive_messages(max_message_count=1, max_wait_time=5)
                    if not messages:
                        if max_messages is not None:
                            break
                        continue
                    for message in messages:
                        _handle_received(receiver, sender, message, renewer)
                        processed += 1
                        if max_messages is not None and processed >= max_messages:
                            break
    except ServiceBusError as error:
        logger.error(
            "Service Bus worker connection or receive operation failed error_type=%s",
            type(error).__name__,
        )
        raise
