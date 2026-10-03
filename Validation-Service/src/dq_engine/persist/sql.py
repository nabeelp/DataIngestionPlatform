from __future__ import annotations

import json
import uuid
from datetime import UTC, date, datetime, time
from typing import Any

from mssql_python import connect
from mssql_python.connection import Connection

from dq_engine.config import get_settings
from dq_engine.contracts.models import DefinitionContract, ValidationRequest
from dq_engine.engine import CheckResult, ValidationOutcome


class PermanentJobError(ValueError):
    """A queued validation request cannot be processed successfully."""


def _split_connection_string(value: str) -> list[str]:
    parts: list[str] = []
    start = 0
    in_braces = False
    index = 0
    while index < len(value):
        character = value[index]
        if character == "{" and not in_braces:
            in_braces = True
        elif character == "}" and in_braces:
            if index + 1 < len(value) and value[index + 1] == "}":
                index += 1
            else:
                in_braces = False
        elif character == ";" and not in_braces:
            parts.append(value[start:index].strip())
            start = index + 1
        index += 1
    parts.append(value[start:].strip())
    return [part for part in parts if part]


def _mssql_python_connection_string(value: str) -> tuple[str, int]:
    aliases = {
        "data source": "server",
        "initial catalog": "database",
        "user id": "uid",
        "user": "uid",
        "password": "pwd",
        "connection timeout": "timeout",
        "connect timeout": "timeout",
        "login timeout": "timeout",
        "timeout": "timeout",
    }
    ignored = {
        "application name",
        "app",
        "mars_connection",
        "multipleactiveresultsets",
        "pooling",
        "max pool size",
        "min pool size",
        "workstation id",
        "wsid",
    }
    normalized: list[str] = []
    timeout = 0
    for part in _split_connection_string(value):
        key, separator, parameter = part.partition("=")
        if not separator:
            raise ValueError("DB_CONNECTION_STRING contains an invalid parameter.")
        normalized_key = key.strip().casefold()
        if normalized_key in ignored:
            continue
        target_key = aliases.get(normalized_key, key.strip())
        if target_key == "timeout":
            try:
                timeout = int(parameter.strip())
            except ValueError as error:
                raise ValueError("DB_CONNECTION_STRING has an invalid connection timeout.") from error
            continue
        normalized_value = parameter.strip()
        if target_key.casefold() in {"encrypt", "trustservercertificate", "trusted_connection"}:
            normalized_value = {
                "true": "yes",
                "false": "no",
            }.get(normalized_value.casefold(), normalized_value)
        normalized.append(f"{target_key}={normalized_value}")
    return ";".join(normalized), timeout


def _connection() -> Connection:
    connection_string = get_settings().database_connection_string
    if not connection_string:
        raise RuntimeError("Database connection settings are not configured.")
    normalized, timeout = _mssql_python_connection_string(connection_string)
    return connect(normalized, timeout=timeout)


def _as_mapping(cursor: Any, row: Any) -> dict[str, Any]:
    return {
        description[0]: row[index]
        for index, description in enumerate(cursor.description)
    }


def load_job(request: ValidationRequest) -> tuple[dict[str, Any], dict[str, Any]]:
    connection = _connection()
    try:
        cursor = connection.cursor()
        cursor.execute(
            """
            SELECT u.Id, u.FileDefinitionVersionId, u.BlobContainer, u.BlobName,
                   u.OriginalFilename, u.FileType, u.FileSha256, u.ValidationDate,
                   v.Contract
            FROM dbo.Uploads AS u
            INNER JOIN dbo.FileDefinitionVersions AS v
                ON v.Id = u.FileDefinitionVersionId
            WHERE u.Id = %(upload_id)s AND v.Id = %(version_id)s
            """,
            {"upload_id": request.uploadId, "version_id": request.definitionVersionId},
        )
        row = cursor.fetchone()
        if row is None:
            raise PermanentJobError("The upload or pinned definition version was not found.")
        data = _as_mapping(cursor, row)
        if data["FileType"].casefold() != request.fileType.casefold():
            raise PermanentJobError("The validation request file type does not match its upload.")
        if data["BlobContainer"] != request.blob.container or data["BlobName"] != request.blob.name:
            raise PermanentJobError("The validation request blob does not match its upload.")
        contract_payload = json.loads(data.pop("Contract"))
        return data, contract_payload
    except PermanentJobError:
        raise
    except (json.JSONDecodeError, TypeError, ValueError) as error:
        raise PermanentJobError("The pinned definition contract is invalid.") from error
    finally:
        connection.close()


def load_upload_blob(upload_id: str) -> dict[str, Any] | None:
    connection = _connection()
    try:
        cursor = connection.cursor()
        cursor.execute(
            """
            SELECT BlobContainer, BlobName, OriginalFilename, FileType, ValidationDate,
                   ParquetPrefix
            FROM dbo.Uploads
            WHERE Id = %(upload_id)s
            """,
            {"upload_id": upload_id},
        )
        row = cursor.fetchone()
        return _as_mapping(cursor, row) if row is not None else None
    finally:
        connection.close()


def mark_started(upload_id: str, started_at: datetime) -> None:
    connection = _connection()
    try:
        cursor = connection.cursor()
        cursor.execute(
            """
            UPDATE dbo.Uploads
            SET Status = 'VALIDATION_IN_PROGRESS',
                ValidationStartedAt = %(started_at)s,
                ErrorMessage = NULL
            WHERE Id = %(upload_id)s
            """,
            {"started_at": started_at.replace(tzinfo=None), "upload_id": upload_id},
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def persist_success(
    upload_id: str,
    outcome: ValidationOutcome,
    contract: DefinitionContract,
    started_at: datetime,
    validation_date: date,
    detected_encoding: str,
    file_sha256: str,
    report_blob_name: str,
    parquet_prefix: str,
    engine_version: str,
    sheet_count: int,
) -> dict[str, int]:
    now = datetime.now(UTC).replace(tzinfo=None)
    started = started_at.astimezone(UTC).replace(tzinfo=None)
    counts: dict[str, int] = {
        "passed": sum(check.status == "PASSED" for check in outcome.checks),
        "failed": sum(check.status in {"FAILED", "ERROR"} for check in outcome.checks),
        "warnings": sum(check.status == "WARNING" for check in outcome.checks),
        "rowCount": sum(outcome.row_counts.values()),
    }
    status = outcome.status
    validation_result_status = status if status in {"PASSED", "FAILED", "WARNING"} else "FAILED"
    total_errors = sum(
        check.issue_count for check in outcome.checks
        if check.severity.casefold() == "error"
    )
    total_warnings = sum(
        check.issue_count for check in outcome.checks
        if check.severity.casefold() == "warning"
    )
    result_id = str(uuid.uuid4())

    connection = _connection()
    try:
        connection.autocommit = False
        cursor = connection.cursor()
        cursor.execute(
            "DELETE FROM dbo.ValidationRuleDetails WHERE UploadId = %(upload_id)s",
            {"upload_id": upload_id},
        )
        cursor.execute(
            "DELETE FROM dbo.ValidationResults WHERE UploadId = %(upload_id)s",
            {"upload_id": upload_id},
        )
        cursor.execute(
            """
            INSERT INTO dbo.ValidationResults
                (Id, UploadId, TotalRules, PassedRules, FailedRules, WarningRules,
                 ProgressPercent, CurrentRule, Status, StartedAt, CompletedAt,
                 TotalErrors, TotalWarnings, ErrorSummary)
            VALUES
                (%(id)s, %(upload_id)s, %(total_rules)s, %(passed)s, %(failed)s,
                 %(warnings)s, 100, NULL, %(status)s, %(started_at)s, %(completed_at)s,
                 %(total_errors)s, %(total_warnings)s, NULL)
            """,
            {
                "id": result_id,
                "upload_id": upload_id,
                "total_rules": len(outcome.checks),
                "passed": counts["passed"],
                "failed": counts["failed"],
                "warnings": counts["warnings"],
                "status": validation_result_status,
                "started_at": started,
                "completed_at": now,
                "total_errors": total_errors,
                "total_warnings": total_warnings,
            },
        )
        for check in outcome.checks:
            _insert_check(cursor, upload_id, result_id, check, contract)
        cursor.execute(
            """
            UPDATE dbo.Uploads
            SET Status = %(status)s,
                ValidationDate = %(validation_date)s,
                DetectedEncoding = %(encoding)s,
                FileSha256 = %(file_sha256)s,
                ReportBlobName = %(report_blob)s,
                ParquetPrefix = %(parquet_prefix)s,
                EngineVersion = %(engine_version)s,
                RowCountNo = %(row_count)s,
                SheetCount = %(sheet_count)s,
                ValidationCompletedAt = %(completed_at)s,
                ErrorMessage = NULL
            WHERE Id = %(upload_id)s
            """,
            {
                "status": "VALIDATION_FAILED" if status == "FAILED" else "VALIDATION_PASSED",
                "validation_date": datetime.combine(validation_date, time.min),
                "encoding": detected_encoding,
                "file_sha256": file_sha256,
                "report_blob": report_blob_name,
                "parquet_prefix": parquet_prefix,
                "engine_version": engine_version,
                "row_count": counts["rowCount"],
                "sheet_count": sheet_count,
                "completed_at": now,
                "upload_id": upload_id,
            },
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
    return counts


def _insert_check(
    cursor: Any,
    upload_id: str,
    result_id: str,
    check: CheckResult,
    contract: DefinitionContract,
) -> None:
    issues = [
        {
            "sheet": check.sheet,
            "row": issue.row,
            "column": issue.column,
            "value": issue.value,
            "message": issue.message,
        }
        for issue in check.issues
    ]
    rule = next((item for item in contract.rules if item.id == check.id), None)
    cursor.execute(
        """
        INSERT INTO dbo.ValidationRuleDetails
            (Id, ValidationResultId, UploadId, RuleId, RuleName, RuleType,
             RuleSeverity, ExecutionOrder, Status, IssueCount, Issues, ElapsedMs, Sheet)
        VALUES
            (%(id)s, %(result_id)s, %(upload_id)s, %(rule_id)s, %(rule_name)s,
             %(rule_type)s, %(severity)s, %(execution_order)s, %(status)s,
             %(issue_count)s, %(issues)s, %(elapsed_ms)s, %(sheet)s)
        """,
        {
            "id": str(uuid.uuid4()),
            "result_id": result_id,
            "upload_id": upload_id,
            "rule_id": rule.id if rule is not None else None,
            "rule_name": check.name,
            "rule_type": check.type,
            "severity": check.severity,
            "execution_order": rule.executionOrder if rule is not None else 0,
            "status": check.status,
            "issue_count": check.issue_count,
            "issues": json.dumps(issues, ensure_ascii=False),
            "elapsed_ms": check.elapsed_ms,
            "sheet": check.sheet,
        },
    )


def persist_failure(upload_id: str, reason: str) -> None:
    connection = _connection()
    try:
        connection.autocommit = False
        cursor = connection.cursor()
        cursor.execute(
            "DELETE FROM dbo.ValidationRuleDetails WHERE UploadId = %(upload_id)s",
            {"upload_id": upload_id},
        )
        cursor.execute(
            "DELETE FROM dbo.ValidationResults WHERE UploadId = %(upload_id)s",
            {"upload_id": upload_id},
        )
        cursor.execute(
            """
            UPDATE dbo.Uploads
            SET Status = 'VALIDATION_FAILED',
                ValidationCompletedAt = SYSUTCDATETIME(),
                ErrorMessage = %(reason)s
            WHERE Id = %(upload_id)s
            """,
            {"reason": reason, "upload_id": upload_id},
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
