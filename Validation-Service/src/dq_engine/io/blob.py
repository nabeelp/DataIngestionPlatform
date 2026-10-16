from __future__ import annotations

from contextlib import nullcontext
from pathlib import Path
from typing import BinaryIO
from urllib.parse import urlsplit

from azure.identity import DefaultAzureCredential
from azure.storage.blob import BlobServiceClient, ContentSettings

from dq_engine.config import Settings, get_settings


def _blob_api_version(settings: Settings) -> str | None:
    if settings.storage_api_version:
        return settings.storage_api_version
    connection_string = settings.storage_connection_string
    if not connection_string:
        return None
    parameters: dict[str, str] = {}
    for part in connection_string.split(";"):
        key, separator, value = part.partition("=")
        if separator:
            parameters[key.strip().casefold()] = value.strip()
    if parameters.get("usedevelopmentstorage", "").casefold() == "true":
        return "2025-07-05"
    endpoint = urlsplit(parameters.get("blobendpoint", ""))
    if endpoint.hostname in {"localhost", "127.0.0.1", "::1", "azurite"}:
        return "2025-07-05"
    return None


class BlobStore:
    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        api_version = _blob_api_version(self._settings)
        if self._settings.storage_connection_string:
            if api_version:
                self._service = BlobServiceClient.from_connection_string(
                    self._settings.storage_connection_string,
                    api_version=api_version,
                )
            else:
                self._service = BlobServiceClient.from_connection_string(
                    self._settings.storage_connection_string,
                )
        elif self._settings.storage_account_url:
            credential = DefaultAzureCredential()
            if api_version:
                self._service = BlobServiceClient(
                    self._settings.storage_account_url,
                    credential=credential,
                    api_version=api_version,
                )
            else:
                self._service = BlobServiceClient(
                    self._settings.storage_account_url,
                    credential=credential,
                )
        else:
            raise ValueError("Blob Storage connection settings are not configured.")

    def download_to_path(self, container: str, name: str, path: Path) -> int:
        client = self._service.get_blob_client(container=container, blob=name)
        with path.open("wb") as output:
            return int(client.download_blob().readinto(output))

    def list_blob_names(self, container: str, prefix: str) -> list[str]:
        client = self._service.get_container_client(container)
        return [blob.name for blob in client.list_blobs(name_starts_with=prefix)]

    def upload_file(
        self,
        container: str,
        name: str,
        source: Path | BinaryIO,
        content_type: str | None = None,
    ) -> None:
        client = self._service.get_blob_client(container=container, blob=name)
        settings = ContentSettings(content_type=content_type) if content_type else None
        stream_context = source.open("rb") if isinstance(source, Path) else nullcontext(source)
        with stream_context as stream:
            client.upload_blob(stream, overwrite=True, content_settings=settings)
