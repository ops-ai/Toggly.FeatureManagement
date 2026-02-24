"""Live smoke tests for core toggly package."""

import os

from toggly import TogglyClient, TogglyConfig


SMOKE_ENVIRONMENT = "Production"
FLAG_ON = "FlagOn"
FLAG_OFF = "FlagOff"


def _require_app_key() -> str:
    app_key = os.getenv("TOGGLY_SMOKE_APP_KEY_BACKEND")
    if not app_key:
        # pytest-style skip without extra dependency import
        import pytest
        pytest.skip("TOGGLY_SMOKE_APP_KEY_BACKEND is not set")
    return app_key


def _run_smoke(use_signed_definitions: bool) -> None:
    app_key = _require_app_key()
    client = TogglyClient(
        TogglyConfig(
            app_key=app_key,
            environment=SMOKE_ENVIRONMENT,
            base_url="https://definitions.toggly.io",
            use_signed_definitions=use_signed_definitions,
            disable_background_refresh=True,
            refresh_interval=0,
        )
    )
    response = client.init()

    assert response.error is None
    assert client.is_enabled(FLAG_ON) is True
    assert client.is_enabled(FLAG_OFF) is False


def test_smoke_unsigned_definitions() -> None:
    _run_smoke(use_signed_definitions=False)


def test_smoke_signed_definitions() -> None:
    _run_smoke(use_signed_definitions=True)


def test_smoke_websocket_connection() -> None:
    """Verify WebSocket connection to Toggly definitions endpoint."""
    app_key = _require_app_key()
    import json

    try:
        from websockets.sync.client import connect as ws_connect  # type: ignore[import-untyped]
    except ImportError:
        import pytest

        pytest.skip("websockets package not installed")

    with ws_connect(
        f"wss://definitions.toggly.io/{app_key}/ws",
        close_timeout=5,
    ) as ws:
        for _ in range(5):
            message = ws.recv(timeout=15)
            assert isinstance(message, str)
            parsed = json.loads(message)
            if parsed.get("type") == "ping":
                continue
            assert parsed["type"] in ("definitions", "evaluated")
            assert "timestamp" in parsed
            break
        else:
            raise AssertionError("Never received definitions/evaluated message")
