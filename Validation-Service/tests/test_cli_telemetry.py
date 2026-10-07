from __future__ import annotations

import argparse
import asyncio
import importlib
import sys
from types import ModuleType, SimpleNamespace
from typing import Any

import pytest

from dq_engine import cli, telemetry


def test_api_initializes_telemetry_before_uvicorn_and_shuts_down(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[str] = []
    uvicorn = ModuleType("uvicorn")
    uvicorn.run = lambda *_args, **_kwargs: events.append("run")  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "uvicorn", uvicorn)
    monkeypatch.setattr(cli, "configure_telemetry", lambda: events.append("configure"))
    monkeypatch.setattr(cli, "shutdown_telemetry", lambda: events.append("shutdown"))
    monkeypatch.setattr(cli, "get_settings", lambda: SimpleNamespace(api_host="127.0.0.1", api_port=8000))

    cli._api_command(argparse.Namespace(host=None, port=None))

    assert events == ["configure", "run", "shutdown"]


def test_api_shuts_down_telemetry_when_uvicorn_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    events: list[str] = []
    uvicorn = ModuleType("uvicorn")

    def fail_run(*_: Any, **__: Any) -> None:
        events.append("run")
        raise RuntimeError("server failed")

    uvicorn.run = fail_run  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "uvicorn", uvicorn)
    monkeypatch.setattr(cli, "configure_telemetry", lambda: events.append("configure"))
    monkeypatch.setattr(cli, "shutdown_telemetry", lambda: events.append("shutdown"))
    monkeypatch.setattr(
        cli,
        "shutdown_telemetry_after_error",
        lambda _: cli.shutdown_telemetry(),
    )
    monkeypatch.setattr(cli, "get_settings", lambda: SimpleNamespace(api_host="127.0.0.1", api_port=8000))

    with pytest.raises(RuntimeError, match="server failed"):
        cli._api_command(argparse.Namespace(host=None, port=None))

    assert events == ["configure", "run", "shutdown"]


def test_worker_shuts_down_telemetry_when_run_worker_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    events: list[str] = []
    servicebus = ModuleType("dq_engine.messaging.servicebus")

    def fail_worker(**_: Any) -> None:
        events.append("worker")
        raise RuntimeError("worker failed")

    servicebus.run_worker = fail_worker  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "dq_engine.messaging.servicebus", servicebus)
    monkeypatch.setattr(cli, "configure_telemetry", lambda *_: events.append("configure"))
    monkeypatch.setattr(cli, "shutdown_telemetry", lambda: events.append("shutdown"))
    monkeypatch.setattr(
        cli,
        "shutdown_telemetry_after_error",
        lambda _: cli.shutdown_telemetry(),
    )
    monkeypatch.setattr(
        cli,
        "get_settings",
        lambda: SimpleNamespace(worker_mode="local", worker_max_messages=1),
    )

    with pytest.raises(RuntimeError, match="worker failed"):
        cli._worker_command(argparse.Namespace(max_messages=None))

    assert events == ["configure", "worker", "shutdown"]


def test_api_lifespan_shuts_down_telemetry_on_exception(monkeypatch: pytest.MonkeyPatch) -> None:
    events: list[str] = []
    api = importlib.import_module("dq_engine.api.app")
    monkeypatch.setattr(api, "shutdown_telemetry", lambda: events.append("shutdown"))
    monkeypatch.setattr(
        api,
        "shutdown_telemetry_after_error",
        lambda _: api.shutdown_telemetry(),
    )

    async def run_lifespan() -> None:
        with pytest.raises(RuntimeError, match="request failure"):
            async with api.app.router.lifespan_context(api.app):
                raise RuntimeError("request failure")

    asyncio.run(run_lifespan())

    assert events == ["shutdown"]


def test_cli_preserves_worker_exception_when_telemetry_shutdown_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    servicebus = ModuleType("dq_engine.messaging.servicebus")

    def fail_worker(**_: Any) -> None:
        raise RuntimeError("original worker failure")

    servicebus.run_worker = fail_worker  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "dq_engine.messaging.servicebus", servicebus)
    monkeypatch.setattr(cli, "configure_telemetry", lambda *_: None)
    monkeypatch.setattr(
        cli,
        "get_settings",
        lambda: SimpleNamespace(worker_mode="local", worker_max_messages=1),
    )

    def fail_shutdown() -> None:
        raise ExceptionGroup("shutdown failed", [RuntimeError("exporter shutdown timeout")])

    monkeypatch.setattr(telemetry, "shutdown_telemetry", fail_shutdown)

    with pytest.raises(RuntimeError, match="original worker failure") as captured:
        cli._worker_command(argparse.Namespace(max_messages=None))

    assert any("preserving the application error" in note for note in captured.value.__notes__)
