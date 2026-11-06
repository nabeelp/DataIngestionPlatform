from __future__ import annotations

import io
from pathlib import Path
from typing import Any

import pytest

from dq_engine.config import Settings
from dq_engine.io import blob as blob_module
from dq_engine.io.blob import BlobStore, _blob_api_version


def _settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = dict(
        database_connection_string=None, database_server=None, database_name=None,
        service_bus_connection_string=None, service_bus_namespace=None, validation_queue="q", events_topic="t",
        uploads_container="uploads", reports_container="reports", staging_container="staging",
        storage_connection_string=None, storage_account_url=None, storage_api_version=None,
        rules_service_dev_key=None, rules_service_auth_mode="shared-key", rules_service_api_principal_id=None,
        application_insights_connection_string=None, api_host="0.0.0.0", api_port=8000, worker_mode="local",
        worker_max_messages=1,
    )
    values.update(overrides)
    return Settings(**values)


class _FakeBlob:
    def __init__(self, content: bytes = b"") -> None:
        self.content = content
        self.uploads: list[dict[str, Any]] = []

    def download_blob(self) -> _FakeBlob:
        return self

    def readinto(self, output: Any) -> int:
        output.write(self.content)
        return len(self.content)

    def upload_blob(self, stream: Any, overwrite: bool, content_settings: Any) -> None:
        self.uploads.append({
            "data": stream.read(),
            "overwrite": overwrite,
            "content_type": getattr(content_settings, "content_type", None),
        })


class _FakeContainer:
    def __init__(self, names: list[str]) -> None:
        self.names = names
        self.prefix: str | None = None

    def list_blobs(self, name_starts_with: str) -> list[Any]:
        self.prefix = name_starts_with
        return [type("Item", (), {"name": name}) for name in self.names if name.startswith(name_starts_with)]


class _FakeService:
    last: _FakeService | None = None

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self.args = args
        self.kwargs = kwargs
        self.blob = _FakeBlob(b"payload")
        self.container = _FakeContainer(["a/1.csv", "a/2.csv", "b/3.csv"])
        _FakeService.last = self

    @classmethod
    def from_connection_string(cls, connection_string: str, **kwargs: Any) -> _FakeService:
        return cls(connection_string, **kwargs)

    def get_blob_client(self, container: str, blob: str) -> _FakeBlob:
        self.requested = (container, blob)
        return self.blob

    def get_container_client(self, container: str) -> _FakeContainer:
        return self.container


@pytest.fixture(autouse=True)
def _fake_azure(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(blob_module, "BlobServiceClient", _FakeService)
    monkeypatch.setattr(blob_module, "DefaultAzureCredential", lambda: "credential")


@pytest.mark.parametrize(
    ("connection_string", "expected"),
    [
        (None, None),
        ("DefaultEndpointsProtocol=https;AccountName=prod;BlobEndpoint=https://prod.blob.core.windows.net/", None),
        ("UseDevelopmentStorage=true", "2025-07-05"),
        ("usedevelopmentstorage=TRUE;", "2025-07-05"),
        ("AccountName=dev;BlobEndpoint=http://127.0.0.1:10000/dev;", "2025-07-05"),
        ("AccountName=dev;BlobEndpoint=http://localhost:10000/dev;", "2025-07-05"),
        ("AccountName=dev;BlobEndpoint=http://azurite:10000/dev;", "2025-07-05"),
    ],
)
def test_the_pinned_emulator_api_version_is_used_only_for_local_endpoints(
    connection_string: str | None, expected: str | None
) -> None:
    assert _blob_api_version(_settings(storage_connection_string=connection_string)) == expected


def test_an_explicit_api_version_wins_over_endpoint_detection() -> None:
    settings = _settings(storage_api_version="2024-01-01", storage_connection_string="UseDevelopmentStorage=true")

    assert _blob_api_version(settings) == "2024-01-01"


def test_a_connection_string_creates_the_client_with_the_detected_api_version() -> None:
    BlobStore(_settings(storage_connection_string="UseDevelopmentStorage=true"))

    assert _FakeService.last is not None
    assert _FakeService.last.args == ("UseDevelopmentStorage=true",)
    assert _FakeService.last.kwargs == {"api_version": "2025-07-05"}


def test_a_remote_connection_string_does_not_pin_an_api_version() -> None:
    BlobStore(_settings(storage_connection_string="AccountName=prod;BlobEndpoint=https://prod.blob.core.windows.net/"))

    assert _FakeService.last is not None
    assert _FakeService.last.kwargs == {}


def test_an_account_url_authenticates_with_the_default_credential() -> None:
    BlobStore(_settings(storage_account_url="https://prod.blob.core.windows.net"))

    assert _FakeService.last is not None
    assert _FakeService.last.args == ("https://prod.blob.core.windows.net",)
    assert _FakeService.last.kwargs == {"credential": "credential"}


def test_missing_storage_settings_are_reported() -> None:
    with pytest.raises(ValueError, match="not configured"):
        BlobStore(_settings())


def test_download_streams_the_blob_to_the_target_path(tmp_path: Path) -> None:
    store = BlobStore(_settings(storage_connection_string="UseDevelopmentStorage=true"))
    target = tmp_path / "out.bin"

    written = store.download_to_path("uploads", "id/file.csv", target)

    assert written == len(b"payload")
    assert target.read_bytes() == b"payload"
    assert _FakeService.last is not None and _FakeService.last.requested == ("uploads", "id/file.csv")


def test_blob_names_are_listed_by_prefix() -> None:
    store = BlobStore(_settings(storage_connection_string="UseDevelopmentStorage=true"))

    assert store.list_blob_names("staging", "a/") == ["a/1.csv", "a/2.csv"]


def test_upload_from_a_path_overwrites_and_sets_the_content_type(tmp_path: Path) -> None:
    source = tmp_path / "report.csv"
    source.write_bytes(b"x,y\n1,2\n")
    store = BlobStore(_settings(storage_connection_string="UseDevelopmentStorage=true"))

    store.upload_file("reports", "id/report.csv", source, content_type="text/csv")

    assert _FakeService.last is not None
    assert _FakeService.last.blob.uploads == [{"data": b"x,y\n1,2\n", "overwrite": True, "content_type": "text/csv"}]


def test_upload_from_a_stream_without_a_content_type() -> None:
    store = BlobStore(_settings(storage_connection_string="UseDevelopmentStorage=true"))

    store.upload_file("reports", "id/data.bin", io.BytesIO(b"abc"))

    assert _FakeService.last is not None
    assert _FakeService.last.blob.uploads == [{"data": b"abc", "overwrite": True, "content_type": None}]
