from __future__ import annotations

import hmac

from fastapi import HTTPException, Request, status

from dq_engine.config import get_settings


def require_internal_auth(request: Request) -> None:
    expected = get_settings().rules_service_dev_key
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
