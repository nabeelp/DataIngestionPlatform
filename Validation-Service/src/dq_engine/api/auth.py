from __future__ import annotations

import hmac

from fastapi import HTTPException, Request, status

from dq_engine.config import get_settings

# There is deliberately no default: shared-key is a local-development mode and must be chosen explicitly.
_AUTH_MODES = frozenset({"entra", "shared-key"})


def require_internal_auth(request: Request) -> None:
    settings = get_settings()
    if settings.rules_service_auth_mode not in _AUTH_MODES:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="RULES_SERVICE_AUTH_MODE must be set to 'entra' or 'shared-key'.",
        )
    if settings.rules_service_auth_mode == "entra":
        expected_principal_id = settings.rules_service_api_principal_id
        if not expected_principal_id:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="The rules-service Entra principal is not configured.",
            )
        supplied_principal_id = request.headers.get("x-ms-client-principal-id", "")
        if not supplied_principal_id or not hmac.compare_digest(
            supplied_principal_id.casefold(),
            expected_principal_id.casefold(),
        ):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Internal service authentication failed.",
            )
        return

    expected = settings.rules_service_dev_key
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The internal rules-service credential is not configured.",
        )
    supplied = request.headers.get("x-rules-service-key", "")
    if not supplied or not hmac.compare_digest(supplied, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Internal service authentication failed.",
        )
