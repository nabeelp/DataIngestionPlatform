from __future__ import annotations

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from dq_engine.api.auth import require_internal_auth


def _request(headers: dict[str, str]) -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/v1/rules/validate",
            "headers": [(name.lower().encode(), value.encode()) for name, value in headers.items()],
        }
    )


def test_entra_auth_accepts_only_the_injected_api_principal(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RULES_SERVICE_AUTH_MODE", "entra")
    monkeypatch.setenv("RULES_SERVICE_API_PRINCIPAL_ID", "11111111-1111-1111-1111-111111111111")

    require_internal_auth(
        _request({"x-ms-client-principal-id": "11111111-1111-1111-1111-111111111111"})
    )


def test_entra_auth_rejects_a_different_principal(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RULES_SERVICE_AUTH_MODE", "entra")
    monkeypatch.setenv("RULES_SERVICE_API_PRINCIPAL_ID", "11111111-1111-1111-1111-111111111111")

    with pytest.raises(HTTPException) as error:
        require_internal_auth(
            _request({"x-ms-client-principal-id": "22222222-2222-2222-2222-222222222222"})
        )

    assert error.value.status_code == 401


def test_entra_auth_fails_closed_when_expected_principal_is_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RULES_SERVICE_AUTH_MODE", "entra")
    monkeypatch.delenv("RULES_SERVICE_API_PRINCIPAL_ID", raising=False)

    with pytest.raises(HTTPException) as error:
        require_internal_auth(_request({}))

    assert error.value.status_code == 503


def test_shared_key_auth_remains_available_for_local_development(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RULES_SERVICE_AUTH_MODE", "shared-key")
    monkeypatch.setenv("RULES_SERVICE_DEV_KEY", "local-test-key")

    require_internal_auth(_request({"x-rules-service-key": "local-test-key"}))
