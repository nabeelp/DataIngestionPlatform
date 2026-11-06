from __future__ import annotations

import asyncio
from typing import Any

import pytest
from fastapi import HTTPException

from dq_engine.api import app as app_module


def test_health_advertises_the_features_the_back_end_needs() -> None:
    response = app_module.healthz()

    assert response == {"status": "ok", "features": app_module.SERVICE_FEATURES}
    assert "nl-cross-sheet-v1" in response["features"]


def test_health_is_the_only_unauthenticated_route() -> None:
    public = []
    for route in app_module.app.routes:
        path = getattr(route, "path", "")
        dependencies = getattr(route, "dependencies", [])
        if path.startswith("/v1") and not dependencies:
            public.append(path)

    assert public == []


def test_known_schemas_are_served_and_unknown_ones_are_not_found() -> None:
    schema = app_module.get_schema("definition-contract")

    assert isinstance(schema, dict) and schema
    assert app_module.get_schema("definition-contract.schema.json") == schema
    with pytest.raises(HTTPException) as error:
        app_module.get_schema("nope")
    assert error.value.status_code == 404


def test_a_clean_shutdown_flushes_telemetry(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []
    monkeypatch.setattr(app_module, "shutdown_telemetry", lambda: calls.append("clean"))
    monkeypatch.setattr(app_module, "shutdown_telemetry_after_error", lambda error: calls.append("error"))

    async def run() -> None:
        async with app_module._lifespan(app_module.app):
            pass

    asyncio.run(run())

    assert calls == ["clean"]


def test_a_failed_shutdown_reports_the_error_and_still_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    reported: list[BaseException] = []
    monkeypatch.setattr(app_module, "shutdown_telemetry", lambda: reported.append(RuntimeError("clean path")))
    monkeypatch.setattr(app_module, "shutdown_telemetry_after_error", reported.append)
    failure = RuntimeError("boom")

    async def run() -> None:
        async with app_module._lifespan(app_module.app):
            raise failure

    with pytest.raises(RuntimeError, match="boom"):
        asyncio.run(run())

    assert reported == [failure]


def test_a_dry_run_request_needs_exactly_one_source() -> None:
    contract: dict[str, Any] = {}

    with pytest.raises(ValueError, match="exactly one of uploadId or blob"):
        app_module.DryRunRequest(contract=contract)
    with pytest.raises(ValueError, match="exactly one of uploadId or blob"):
        app_module.DryRunRequest(contract=contract, uploadId="u", blob={"container": "c", "name": "n"})

    assert app_module.DryRunRequest(contract=contract, uploadId="u").uploadId == "u"


def test_the_dry_run_route_reports_a_missing_upload(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(app_module, "load_upload_blob", lambda upload_id: None)

    with pytest.raises(HTTPException) as error:
        app_module.dry_run(app_module.DryRunRequest(contract={}, uploadId="missing"))

    assert error.value.status_code == 404


def test_the_dry_run_route_hides_database_failures(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail(upload_id: str) -> None:
        raise ConnectionError("server=secret-host")

    monkeypatch.setattr(app_module, "load_upload_blob", fail)

    with pytest.raises(HTTPException) as error:
        app_module.dry_run(app_module.DryRunRequest(contract={}, uploadId="u"))

    assert error.value.status_code == 503
    assert "secret-host" not in str(error.value.detail)
