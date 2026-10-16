from __future__ import annotations

from typing import Any

from dq_engine.config import get_settings
from dq_engine.messaging import servicebus


class _Context:
    def __init__(self, value: Any) -> None:
        self.value = value

    def __enter__(self) -> Any:
        return self.value

    def __exit__(self, *_: object) -> None:
        return None


class _Receiver:
    def __init__(self) -> None:
        self.calls = 0

    def receive_messages(self, **_: object) -> list[object]:
        self.calls += 1
        return []


class _Client:
    def __init__(self, receiver: _Receiver, sender: object) -> None:
        self.receiver = receiver
        self.sender = sender

    def __enter__(self) -> _Client:
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def get_queue_receiver(self, **_: object) -> _Context:
        return _Context(self.receiver)

    def get_topic_sender(self, **_: object) -> _Context:
        return _Context(self.sender)


def test_job_worker_exits_when_queue_is_empty(monkeypatch: Any) -> None:
    receiver = _Receiver()
    client = _Client(receiver, object())
    renewer = _Context(object())
    events: list[str] = []

    def configure_worker_telemetry(service_name: str) -> tuple[None, None]:
        events.append(f"telemetry:{service_name}")
        return None, None

    monkeypatch.setattr(
        servicebus,
        "configure_telemetry",
        configure_worker_telemetry,
    )
    monkeypatch.setattr(servicebus, "_service_bus_client", lambda _: (events.append("client"), client)[1])
    monkeypatch.setattr(servicebus, "AutoLockRenewer", lambda **_: renewer)

    servicebus.run_worker(max_messages=1, settings=get_settings())

    assert receiver.calls == 1
    assert events == ["telemetry:data-ingestion-worker", "client"]
