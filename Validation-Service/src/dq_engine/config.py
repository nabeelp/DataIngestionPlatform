from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Settings:
    database_connection_string: str | None
    database_server: str | None
    database_name: str | None
    service_bus_connection_string: str | None
    service_bus_namespace: str | None
    validation_queue: str
    events_topic: str
    uploads_container: str
    reports_container: str
    staging_container: str
    storage_connection_string: str | None
    storage_account_url: str | None
    storage_api_version: str | None
    rules_service_dev_key: str | None
    rules_service_auth_mode: str
    rules_service_api_principal_id: str | None
    application_insights_connection_string: str | None
    api_host: str
    api_port: int
    worker_mode: str
    worker_max_messages: int


def get_settings() -> Settings:
    max_messages = os.getenv("WORKER_MAX_MESSAGES")
    return Settings(
        database_connection_string=os.getenv("DB_CONNECTION_STRING") or None,
        database_server=os.getenv("DB_SERVER") or None,
        database_name=os.getenv("DB_DATABASE") or None,
        service_bus_connection_string=os.getenv("SERVICEBUS_CONNECTION_STRING") or None,
        service_bus_namespace=os.getenv("SERVICEBUS_NAMESPACE") or None,
        validation_queue=os.getenv("SERVICEBUS_VALIDATION_QUEUE", "validation-requests"),
        events_topic=os.getenv("SERVICEBUS_EVENTS_TOPIC", "validation-events"),
        uploads_container=os.getenv("AZURE_STORAGE_UPLOADS_CONTAINER", "uploads"),
        reports_container=os.getenv("AZURE_STORAGE_REPORTS_CONTAINER", "reports"),
        staging_container=os.getenv("AZURE_STORAGE_STAGING_CONTAINER", "staging"),
        storage_connection_string=os.getenv("AZURE_STORAGE_CONNECTION_STRING") or None,
        storage_account_url=os.getenv("AZURE_STORAGE_ACCOUNT_URL") or None,
        storage_api_version=os.getenv("AZURE_STORAGE_API_VERSION") or None,
        rules_service_dev_key=os.getenv("RULES_SERVICE_DEV_KEY") or None,
        rules_service_auth_mode=os.getenv("RULES_SERVICE_AUTH_MODE", "shared-key").casefold(),
        rules_service_api_principal_id=os.getenv("RULES_SERVICE_API_PRINCIPAL_ID") or None,
        application_insights_connection_string=os.getenv("APPLICATIONINSIGHTS_CONNECTION_STRING") or None,
        api_host=os.getenv("RULES_SERVICE_HOST", "0.0.0.0"),
        api_port=int(os.getenv("RULES_SERVICE_PORT", "8000")),
        worker_mode=os.getenv("WORKER_MODE", "local"),
        worker_max_messages=int(max_messages) if max_messages else 1,
    )
