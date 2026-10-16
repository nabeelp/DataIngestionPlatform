from __future__ import annotations

import hashlib
import json
import os
import time
import uuid
from dataclasses import replace
from datetime import UTC, datetime
from typing import Any

import pytest
from azure.core.exceptions import ResourceExistsError, ResourceNotFoundError
from azure.servicebus import ServiceBusClient, ServiceBusMessage
from azure.servicebus.exceptions import ServiceBusError
from azure.storage.blob import BlobServiceClient

from dq_engine.api.app import DryRunRequest, dry_run
from dq_engine.config import Settings, get_settings
from dq_engine.contracts.models import ValidationRequest
from dq_engine.messaging.servicebus import run_worker
from dq_engine.persist.sql import _connection

pytestmark = pytest.mark.skipif(
    os.getenv("RUN_DQ_INTEGRATION_TESTS") != "1",
    reason="Set RUN_DQ_INTEGRATION_TESTS=1 to use the local compose services.",
)


def _contract() -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "layout": "single",
        "ignoredSheets": [],
        "encoding": "auto",
        "tables": [{
            "sheet": None,
            "headerRow": None,
            "allowExtraColumns": False,
            "minRows": 1,
            "maxRows": 10,
            "columns": [{
                "name": "Amount",
                "type": "decimal",
                "mustExist": True,
                "nullable": False,
                "decimalSeparator": ".",
                "thousandsSeparator": None,
            }],
        }],
        "rules": [{
            "id": "amount-range",
            "name": "Amount range",
            "description": "Amount must not be negative.",
            "severity": "Error",
            "executionOrder": 1,
            "enabled": True,
            "table": None,
            "type": "range",
            "params": {"column": "Amount", "min": 0},
        }],
        "lookups": {},
    }


def _request(upload_id: str, version_id: str, blob_name: str) -> ValidationRequest:
    return ValidationRequest.model_validate({
        "schemaVersion": 1,
        "uploadId": upload_id,
        "definitionVersionId": version_id,
        "blob": {"container": "uploads", "name": blob_name},
        "fileType": "csv",
        "requestedAt": datetime.now(UTC).isoformat(),
        "correlationId": str(uuid.uuid4()),
    })


def _wait_for_test_entities(settings: Settings) -> None:
    deadline = time.monotonic() + 60
    last_error: ServiceBusError | None = None
    while time.monotonic() < deadline:
        try:
            with ServiceBusClient.from_connection_string(settings.service_bus_connection_string) as client:
                with client.get_queue_receiver(queue_name=settings.validation_queue):
                    pass
                with client.get_subscription_receiver(
                    topic_name=settings.events_topic,
                    subscription_name="worker-tests",
                ):
                    pass
            return
        except ServiceBusError as error:
            last_error = error
            time.sleep(1)
    raise RuntimeError("Local Service Bus test entities did not become available.") from last_error


def _create_test_records(
    definition_id: str,
    version_id: str,
    upload_id: str,
    contract_json: str,
    blob_name: str,
    checksum: str,
    file_bytes: bytes,
) -> None:
    connection = _connection()
    try:
        cursor = connection.cursor()
        cursor.execute(
            """
            INSERT INTO dbo.FileDefinitions (Id, Name, Description, Contract, Status)
            VALUES (%(id)s, %(name)s, %(description)s, %(contract)s, N'Active')
            """,
            {
                "id": definition_id,
                "name": f"WP5 integration {upload_id}",
                "description": "Temporary automated integration fixture.",
                "contract": contract_json,
            },
        )
        cursor.execute(
            """
            INSERT INTO dbo.FileDefinitionVersions
                (Id, FileDefinitionId, VersionNumber, Status, Contract)
            VALUES (%(id)s, %(definition_id)s, 1, N'Active', %(contract)s)
            """,
            {"id": version_id, "definition_id": definition_id, "contract": contract_json},
        )
        cursor.execute(
            """
            INSERT INTO dbo.Uploads
                (Id, FileDefinitionId, FileDefinitionVersionId, UploadedBy,
                 OriginalFilename, StoredFilename, BlobContainer, BlobName, FileSha256,
                 ValidationDate, FileSize, FileType, Status)
            VALUES
                (%(id)s, %(definition_id)s, %(version_id)s, %(uploaded_by)s,
                 N'wp5-integration.csv', N'wp5-integration.csv', N'uploads', %(blob_name)s,
                 %(checksum)s, SYSUTCDATETIME(), %(file_size)s, N'csv', N'UPLOADED')
            """,
            {
                "id": upload_id,
                "definition_id": definition_id,
                "version_id": version_id,
                "uploaded_by": str(uuid.uuid4()),
                "blob_name": blob_name,
                "checksum": checksum,
                "file_size": len(file_bytes),
            },
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _wait_for_completed(
    settings: Settings,
    upload_id: str,
    topic: str,
    expected_count: int,
) -> dict[str, Any]:
    with ServiceBusClient.from_connection_string(settings.service_bus_connection_string) as client:
        with client.get_subscription_receiver(
            topic_name=topic,
            subscription_name="worker-tests",
        ) as receiver:
            deadline = time.monotonic() + 40
            while time.monotonic() < deadline:
                matching: list[dict[str, Any]] = []
                for message in receiver.peek_messages(max_message_count=100):
                    body = b"".join(bytes(chunk) for chunk in message.body)
                    event = json.loads(body)
                    if event.get("uploadId") == upload_id and event.get("type") == "completed":
                        matching.append(event)
                if len(matching) >= expected_count:
                    return matching[-1]
                time.sleep(0.5)
    raise AssertionError("Worker did not publish a completed event for the test upload.")


def _drain_test_events(settings: Settings) -> None:
    with ServiceBusClient.from_connection_string(settings.service_bus_connection_string) as client:
        with client.get_subscription_receiver(
            topic_name=settings.events_topic,
            subscription_name="worker-tests",
        ) as receiver:
            for _ in range(5):
                messages = receiver.receive_messages(max_message_count=100, max_wait_time=1)
                if not messages:
                    return
                for message in messages:
                    receiver.complete_message(message)


def _send_request(settings: Settings, request: ValidationRequest) -> None:
    with ServiceBusClient.from_connection_string(settings.service_bus_connection_string) as client:
        with client.get_queue_sender(queue_name=settings.validation_queue) as sender:
            sender.send_messages(ServiceBusMessage(request.model_dump_json()))


def _delete_blob_if_present(container: Any, name: str) -> None:
    try:
        container.delete_blob(name, delete_snapshots="include")
    except ResourceNotFoundError:
        pass


def _assert_persisted(upload_id: str) -> None:
    connection = _connection()
    try:
        cursor = connection.cursor()
        cursor.execute(
            """
            SELECT u.Status, r.Status, r.TotalRules, COUNT(DISTINCT r.Id),
                   COUNT(d.Id), SUM(CASE WHEN d.Status = N'PASSED' THEN 1 ELSE 0 END)
            FROM dbo.Uploads AS u
            INNER JOIN dbo.ValidationResults AS r ON r.UploadId = u.Id
            INNER JOIN dbo.ValidationRuleDetails AS d ON d.UploadId = u.Id
            WHERE u.Id = %(upload_id)s
            GROUP BY u.Status, r.Status, r.TotalRules
            """,
            {"upload_id": upload_id},
        )
        rows = cursor.fetchall()
        assert len(rows) == 1
        assert rows[0][0] == "VALIDATION_PASSED"
        assert rows[0][1] == "PASSED"
        assert rows[0][2] >= 1
        assert rows[0][3] == 1
        assert rows[0][4] == rows[0][2]
        assert rows[0][5] == rows[0][2]
    finally:
        connection.close()


def test_worker_processes_and_redelivers_upload_idempotently() -> None:
    settings = get_settings()
    if not settings.database_connection_string or not settings.storage_connection_string:
        pytest.fail("Local database and Blob Storage settings are required for this integration test.")
    if not settings.service_bus_connection_string:
        pytest.fail("The local Service Bus emulator connection string is required.")
    integration_settings = replace(settings, events_topic="validation-events-wp5-test")
    _wait_for_test_entities(integration_settings)

    upload_id = str(uuid.uuid4())
    definition_id = str(uuid.uuid4())
    version_id = str(uuid.uuid4())
    blob_name = f"wp5-integration/{upload_id}/input.csv"
    file_bytes = b"Amount\n12.50\n20.00\n"
    checksum = hashlib.sha256(file_bytes).hexdigest()
    contract_json = json.dumps(_contract())
    blob_service = BlobServiceClient.from_connection_string(
        settings.storage_connection_string,
        api_version=settings.storage_api_version or "2025-07-05",
    )
    upload_container = blob_service.get_container_client(settings.uploads_container)
    report_container = blob_service.get_container_client(settings.reports_container)
    staging_container = blob_service.get_container_client(settings.staging_container)
    for container in (upload_container, report_container, staging_container):
        try:
            container.create_container()
        except ResourceExistsError:
            pass

    try:
        upload_container.upload_blob(blob_name, file_bytes, overwrite=True)
        _create_test_records(
            definition_id,
            version_id,
            upload_id,
            contract_json,
            blob_name,
            checksum,
            file_bytes,
        )
        request = _request(upload_id, version_id, blob_name)
        _send_request(settings, request)

        run_worker(max_messages=1, settings=integration_settings)
        completed = _wait_for_completed(integration_settings, upload_id, integration_settings.events_topic, 1)
        assert completed["summary"]["status"] == "PASSED"
        _assert_persisted(upload_id)
        assert report_container.get_blob_client(f"{upload_id}/issues.csv").exists()
        parquet = list(staging_container.list_blobs(name_starts_with=f"parquet/{upload_id}/"))
        assert len(parquet) == 1
        preview = dry_run(DryRunRequest(contract=_contract(), uploadId=upload_id))
        assert preview["status"] == "PASSED"

        _send_request(settings, request)
        run_worker(max_messages=1, settings=integration_settings)
        redelivered = _wait_for_completed(integration_settings, upload_id, integration_settings.events_topic, 2)
        assert redelivered["summary"] == completed["summary"]
        _assert_persisted(upload_id)
    finally:
        connection = _connection()
        try:
            cursor = connection.cursor()
            cursor.execute(
                "DELETE FROM dbo.ValidationRuleDetails WHERE UploadId = %(upload_id)s",
                {"upload_id": upload_id},
            )
            cursor.execute(
                "DELETE FROM dbo.ValidationResults WHERE UploadId = %(upload_id)s",
                {"upload_id": upload_id},
            )
            cursor.execute("DELETE FROM dbo.Uploads WHERE Id = %(upload_id)s", {"upload_id": upload_id})
            cursor.execute(
                "DELETE FROM dbo.FileDefinitionVersions WHERE Id = %(version_id)s",
                {"version_id": version_id},
            )
            cursor.execute(
                "DELETE FROM dbo.FileDefinitions WHERE Id = %(definition_id)s",
                {"definition_id": definition_id},
            )
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()
        _delete_blob_if_present(upload_container, blob_name)
        _delete_blob_if_present(report_container, f"{upload_id}/issues.csv")
        for blob in staging_container.list_blobs(name_starts_with=f"parquet/{upload_id}/"):
            _delete_blob_if_present(staging_container, blob.name)
        _drain_test_events(integration_settings)
