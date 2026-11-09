from __future__ import annotations

import pytest

from dq_engine.config import get_settings

_ENV_NAMES = (
    "DB_CONNECTION_STRING", "DB_SERVER", "DB_DATABASE", "SERVICEBUS_CONNECTION_STRING", "SERVICEBUS_NAMESPACE",
    "SERVICEBUS_VALIDATION_QUEUE", "SERVICEBUS_EVENTS_TOPIC", "AZURE_STORAGE_UPLOADS_CONTAINER",
    "AZURE_STORAGE_REPORTS_CONTAINER", "AZURE_STORAGE_STAGING_CONTAINER", "AZURE_STORAGE_CONNECTION_STRING",
    "AZURE_STORAGE_ACCOUNT_URL", "AZURE_STORAGE_API_VERSION", "RULES_SERVICE_DEV_KEY", "RULES_SERVICE_AUTH_MODE",
    "RULES_SERVICE_API_PRINCIPAL_ID", "APPLICATIONINSIGHTS_CONNECTION_STRING", "RULES_SERVICE_HOST",
    "RULES_SERVICE_PORT", "WORKER_MODE", "WORKER_MAX_MESSAGES",
)


@pytest.fixture(autouse=True)
def _clean_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in _ENV_NAMES:
        monkeypatch.delenv(name, raising=False)


def test_defaults_describe_the_local_worker_and_the_standard_entities() -> None:
    settings = get_settings()

    assert settings.validation_queue == "validation-requests"
    assert settings.events_topic == "validation-events"
    assert (settings.uploads_container, settings.reports_container, settings.staging_container) == (
        "uploads", "reports", "staging",
    )
    assert (settings.api_host, settings.api_port) == ("0.0.0.0", 8000)
    assert (settings.worker_mode, settings.worker_max_messages) == ("local", 1)


def test_unset_credentials_are_none_and_the_auth_mode_has_no_default() -> None:
    settings = get_settings()

    assert settings.database_connection_string is None
    assert settings.service_bus_connection_string is None
    assert settings.storage_connection_string is None
    assert settings.rules_service_dev_key is None
    assert settings.rules_service_auth_mode == ""


def test_empty_values_are_treated_as_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DB_CONNECTION_STRING", "")
    monkeypatch.setenv("AZURE_STORAGE_ACCOUNT_URL", "")
    monkeypatch.setenv("RULES_SERVICE_DEV_KEY", "")
    monkeypatch.setenv("WORKER_MAX_MESSAGES", "")

    settings = get_settings()

    assert settings.database_connection_string is None
    assert settings.storage_account_url is None
    assert settings.rules_service_dev_key is None
    assert settings.worker_max_messages == 1


def test_environment_overrides_are_read(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SERVICEBUS_VALIDATION_QUEUE", "queue-a")
    monkeypatch.setenv("SERVICEBUS_EVENTS_TOPIC", "topic-a")
    monkeypatch.setenv("AZURE_STORAGE_UPLOADS_CONTAINER", "in")
    monkeypatch.setenv("RULES_SERVICE_HOST", "127.0.0.1")
    monkeypatch.setenv("RULES_SERVICE_PORT", "9100")
    monkeypatch.setenv("WORKER_MODE", "job")
    monkeypatch.setenv("WORKER_MAX_MESSAGES", "5")
    monkeypatch.setenv("DB_SERVER", "server")
    monkeypatch.setenv("DB_DATABASE", "database")

    settings = get_settings()

    assert (settings.validation_queue, settings.events_topic, settings.uploads_container) == (
        "queue-a", "topic-a", "in",
    )
    assert (settings.api_host, settings.api_port) == ("127.0.0.1", 9100)
    assert (settings.worker_mode, settings.worker_max_messages) == ("job", 5)
    assert (settings.database_server, settings.database_name) == ("server", "database")


@pytest.mark.parametrize("raw", ["entra", " ENTRA ", "Entra\n"])
def test_the_auth_mode_is_normalised(monkeypatch: pytest.MonkeyPatch, raw: str) -> None:
    monkeypatch.setenv("RULES_SERVICE_AUTH_MODE", raw)

    assert get_settings().rules_service_auth_mode == "entra"


@pytest.mark.parametrize("name", ["RULES_SERVICE_PORT", "WORKER_MAX_MESSAGES"])
def test_non_numeric_numbers_fail_loudly(monkeypatch: pytest.MonkeyPatch, name: str) -> None:
    monkeypatch.setenv(name, "many")

    with pytest.raises(ValueError):
        get_settings()
