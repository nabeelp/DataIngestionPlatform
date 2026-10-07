# ruff: noqa: E402

from __future__ import annotations

import json
import multiprocessing
import queue
import re
import tempfile
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import date, datetime
from pathlib import Path
from typing import Any

from dq_engine.telemetry import configure_telemetry, shutdown_telemetry, shutdown_telemetry_after_error

configure_telemetry()

from fastapi import Depends, FastAPI, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, model_validator

from dq_engine.analyze.example_analyzer import analyze_blob
from dq_engine.api.auth import require_internal_auth
from dq_engine.api.validation import (
    test_rule_examples,
    validate_contract_payload,
    validate_rule_payload,
)
from dq_engine.config import get_settings
from dq_engine.contracts.models import BlobReference, DefinitionContract
from dq_engine.engine import validate_file, validate_parsed
from dq_engine.io.blob import BlobStore
from dq_engine.io.models import UnrecoverableFileError
from dq_engine.io.parquet_reader import read_parquet_tables
from dq_engine.persist.sql import load_upload_blob

_ROOT = Path(__file__).resolve().parents[4]
_CONTRACTS = _ROOT / "contracts"
_SCHEMAS = {
    path.name.removesuffix(".schema.json"): path
    for path in _CONTRACTS.rglob("*.schema.json")
}
_SUPPORTED_TYPES = {"csv", "tsv", "txt", "xlsx", "xlsm", "xls", "xlsb"}


@asynccontextmanager
async def _lifespan(_: FastAPI) -> AsyncIterator[None]:
    try:
        yield
    except BaseException as error:
        shutdown_telemetry_after_error(error)
        raise
    else:
        shutdown_telemetry()


app = FastAPI(title="Data Quality Rules Service", version="0.1.0", lifespan=_lifespan)


class RuleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contract: dict[str, Any]
    rule: dict[str, Any]


class RuleTestRequest(RuleRequest):
    examples: list[dict[str, Any]] | None = None


class ContractValidateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contract: dict[str, Any]


class DryRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contract: dict[str, Any]
    uploadId: str | None = Field(default=None, min_length=1)
    blob: BlobReference | None = None
    validationDate: date | None = None

    @model_validator(mode="after")
    def exactly_one_source(self) -> DryRunRequest:
        if (self.uploadId is None) == (self.blob is None):
            raise ValueError("Provide exactly one of uploadId or blob.")
        return self


class ExampleAnalyzeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    blob: BlobReference


def _dry_run_child(
    path: str | None,
    parquet_paths: list[str],
    contract: dict[str, Any],
    validation_date: str,
    result_queue: Any,
) -> None:
    try:
        parsed_contract = DefinitionContract.model_validate(contract)
        run_date = date.fromisoformat(validation_date)
        if parquet_paths:
            parsed = read_parquet_tables([Path(item) for item in parquet_paths], parsed_contract)
            outcome = validate_parsed(parsed, parsed_contract, run_date)
        elif path:
            outcome = validate_file(Path(path), parsed_contract, run_date)
        else:
            raise ValueError("Dry run has no file or Parquet source.")
        result_queue.put((True, outcome.as_dict()))
    except (OSError, ValueError) as error:
        result_queue.put((False, str(error)))


def _run_dry_run(
    path: Path | None,
    contract: dict[str, Any],
    validation_date: date,
    parquet_paths: list[Path] | None = None,
) -> dict[str, Any]:
    context = multiprocessing.get_context("spawn")
    result_queue = context.Queue(maxsize=1)
    process = context.Process(
        target=_dry_run_child,
        args=(
            str(path) if path else None,
            [str(item) for item in parquet_paths or []],
            contract,
            validation_date.isoformat(),
            result_queue,
        ),
    )
    process.start()
    deadline = time.monotonic() + 60
    result: tuple[bool, Any] | None = None
    while process.is_alive() and time.monotonic() < deadline and result is None:
        try:
            result = result_queue.get(timeout=min(0.1, deadline - time.monotonic()))
        except queue.Empty:
            continue
    process.join(max(0, deadline - time.monotonic()))
    if process.is_alive():
        process.terminate()
        process.join()
        result_queue.close()
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Dry run exceeded the 60-second execution limit.",
        )
    if result is None:
        try:
            result = result_queue.get(timeout=1)
        except queue.Empty as error:
            result_queue.close()
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Dry run could not validate the supplied file.",
            ) from error
    result_queue.close()
    succeeded, payload = result
    if process.exitcode != 0 or not succeeded:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(payload) if succeeded is False else "Dry run failed.",
        )
    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Dry run returned an invalid result.",
        )
    return payload


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/v1/schemas/{name}", dependencies=[Depends(require_internal_auth)])
def get_schema(name: str) -> dict[str, Any]:
    path = _SCHEMAS.get(name.removesuffix(".schema.json"))
    if path is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Schema not found.")
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Schema is invalid.")
    return payload


@app.post("/v1/rules/validate", dependencies=[Depends(require_internal_auth)])
def validate_rule(request: RuleRequest) -> dict[str, Any]:
    return validate_rule_payload(request.contract, request.rule)


@app.post("/v1/rules/test", dependencies=[Depends(require_internal_auth)])
def run_rule_examples(request: RuleTestRequest) -> dict[str, Any]:
    return test_rule_examples(request.contract, request.rule, request.examples)


@app.post("/v1/contracts/validate", dependencies=[Depends(require_internal_auth)])
def validate_contract(request: ContractValidateRequest) -> dict[str, Any]:
    return validate_contract_payload(request.contract)


@app.post("/v1/dry-run", dependencies=[Depends(require_internal_auth)])
def dry_run(request: DryRunRequest) -> dict[str, Any]:
    parquet_names: list[str] = []
    if request.uploadId:
        try:
            upload = load_upload_blob(request.uploadId)
        except Exception as error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="The upload record could not be loaded.",
            ) from error
        if upload is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Upload not found.")
        container = str(upload["BlobContainer"])
        blob_name = str(upload["BlobName"])
        file_type = str(upload["FileType"]).casefold()
        stored_validation_date = upload["ValidationDate"]
        validation_date = (
            stored_validation_date.date()
            if isinstance(stored_validation_date, datetime)
            else stored_validation_date
        )
        if request.validationDate is not None:
            validation_date = request.validationDate
        parquet_prefix = upload.get("ParquetPrefix")
        if parquet_prefix:
            settings = get_settings()
            try:
                names = BlobStore().list_blob_names(settings.staging_container, str(parquet_prefix))
            except Exception as error:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="The stored Parquet artifacts could not be listed.",
                ) from error
            indexed_names = []
            for name in names:
                match = re.fullmatch(r"table-(\d+)\.parquet", Path(name).name)
                if match:
                    indexed_names.append((int(match.group(1)), name))
            indexed_names.sort()
            table_definitions = request.contract.get("tables")
            expected_indices = (
                list(range(1, len(table_definitions) + 1))
                if isinstance(table_definitions, list)
                else []
            )
            if [index for index, _ in indexed_names] == expected_indices and expected_indices:
                parquet_names = [name for _, name in indexed_names]
    else:
        if request.blob is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A blob reference is required.")
        container = request.blob.container
        blob_name = request.blob.name
        file_type = Path(blob_name).suffix.lstrip(".").casefold()
        validation_date = request.validationDate
    if container != get_settings().uploads_container:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Blob container is not allowed.")
    if file_type not in _SUPPORTED_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported file type.")
    if validation_date is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A fixed validationDate is required for a blob dry run.",
        )

    with tempfile.TemporaryDirectory(prefix="dq-dry-run-") as directory:
        store = BlobStore()
        if parquet_names:
            parquet_paths = [
                Path(directory) / f"table-{index}.parquet"
                for index in range(1, len(parquet_names) + 1)
            ]
            try:
                for name, path in zip(parquet_names, parquet_paths, strict=True):
                    store.download_to_path(get_settings().staging_container, name, path)
            except Exception as error:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="A stored Parquet table could not be downloaded.",
                ) from error
            outcome = _run_dry_run(None, request.contract, validation_date, parquet_paths)
        else:
            path = Path(directory) / f"dry-run.{file_type}"
            try:
                store.download_to_path(container, blob_name, path)
            except Exception as error:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="The requested blob could not be downloaded.",
                ) from error
            outcome = _run_dry_run(path, request.contract, validation_date)

    checks = outcome["checks"]
    return {
        "status": outcome["status"],
        "checks": [
            {
                "id": check["id"],
                "name": check["name"],
                "type": check["type"],
                "severity": check["severity"],
                "status": check["status"],
                "issueCount": check["issue_count"],
                "issues": [
                    {
                        "sheet": check["sheet"],
                        **issue,
                    }
                    for issue in check["issues"][:5]
                ],
            }
            for check in checks
        ],
        "structuralIssues": outcome["structuralIssues"][:20],
        "rowCounts": outcome["rowCounts"],
    }


@app.post("/v1/examples/analyze", dependencies=[Depends(require_internal_auth)])
def analyze_example(request: ExampleAnalyzeRequest) -> dict[str, Any]:
    if request.blob.container != get_settings().uploads_container:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Blob container is not allowed.")
    try:
        return analyze_blob(request.blob.container, request.blob.name)
    except UnrecoverableFileError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="The example file could not be analyzed.",
        ) from error
