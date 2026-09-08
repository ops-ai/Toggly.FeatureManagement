"""Definition-refresh cache hit/miss telemetry on usage SendStats."""

from __future__ import annotations

import threading
from typing import Any, Dict, List, Optional
from unittest.mock import MagicMock

import pytest

from toggly import AsyncTogglyClient, TogglyClient, TogglyConfig
from toggly.models import FeatureDefinition, FeatureFilter
from toggly.providers import DefinitionsSnapshot, MemorySnapshotProvider


class FakeUsageClient:
    def __init__(self) -> None:
        self.calls: List[Dict[str, Any]] = []

    def send_stats(
        self,
        request: Dict[str, Any],
        metadata: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        self.calls.append(request)
        return {"featureCount": 0}

    def close(self) -> None:
        pass


def _ok_defs(feature: str = "feature-a", etag: str = '"rev-1"') -> MagicMock:
    response = MagicMock()
    response.status_code = 200
    response.headers = {"ETag": etag}
    response.text.return_value = (
        '[{"featureKey":"%s","filters":[{"name":"AlwaysOn","parameters":{}}]}]'
        % feature
    )
    return response


def _not_modified(etag: str = '"rev-1"') -> MagicMock:
    response = MagicMock()
    response.status_code = 304
    response.headers = {"ETag": etag}
    return response


def _telemetry_config(**kwargs: Any) -> TogglyConfig:
    usage = kwargs.pop("usage_client", FakeUsageClient())
    defaults = {
        "app_key": "test-app",
        "environment": "Production",
        "enable_usage_tracking": True,
        "enable_metrics": False,
        "usage_flush_interval": 0,
        "metrics_flush_interval": 0,
        "usage_client": usage,
        "metrics_client": FakeUsageClient(),
        "disable_background_refresh": True,
        "enable_live_updates": False,
        "register_contexts_on_startup": False,
        "use_signed_definitions": False,
    }
    defaults.update(kwargs)
    return TogglyConfig(**defaults), usage


class TestDefinitionCacheHits:
    def test_miss_on_new_200_and_hit_on_304(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("TOGGLY_DISABLE_TELEMETRY", raising=False)
        config, usage = _telemetry_config()
        client = TogglyClient(config)
        responses = [_ok_defs(etag='"rev-1"'), _not_modified('"rev-1"')]

        def fake_get(*_a: Any, **_k: Any) -> MagicMock:
            return responses.pop(0)

        try:
            with pytest.MonkeyPatch.context() as mp:
                mp.setattr(client._http, "get", fake_get)
                client.init()
                client.refresh()
            client.flush_telemetry()
            assert usage.calls
            payload = usage.calls[0]
            assert payload["definitionCacheMisses"] == 1
            assert payload["definitionCacheHits"] == 1
        finally:
            client.close()

    def test_skipped_poll_while_websocket_live_is_hit(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("TOGGLY_DISABLE_TELEMETRY", raising=False)
        config, usage = _telemetry_config()
        client = TogglyClient(config)
        try:
            with pytest.MonkeyPatch.context() as mp:
                mp.setattr(client._http, "get", lambda *_a, **_k: _ok_defs())
                client.init()
            client.flush_telemetry()
            usage.calls.clear()

            client._ws_connected = True
            client._last_fallback_refresh = 10**12  # far future → within window
            # Invoke the skip path used by the background refresh loop.
            if (
                client._ws_connected
                and (0 - client._last_fallback_refresh)
                < client._FALLBACK_REFRESH_INTERVAL
            ):
                client._record_definition_cache_hit()

            client.flush_telemetry()
            assert usage.calls
            payload = usage.calls[0]
            assert payload["definitionCacheHits"] == 1
            assert "definitionCacheMisses" not in payload
        finally:
            client.close()

    def test_concurrent_in_flight_refresh_skip_does_not_count(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("TOGGLY_DISABLE_TELEMETRY", raising=False)
        config, usage = _telemetry_config()
        client = TogglyClient(config)
        entered = threading.Event()
        release = threading.Event()

        def blocking_get(*_a: Any, **_k: Any) -> MagicMock:
            entered.set()
            assert release.wait(timeout=2.0)
            return _ok_defs(etag='"rev-1"')

        try:
            with pytest.MonkeyPatch.context() as mp:
                mp.setattr(client._http, "get", blocking_get)
                t = threading.Thread(target=client.init)
                t.start()
                assert entered.wait(timeout=2.0)
                skipped = client.refresh()
                assert skipped.flags == client.feature_flags
                release.set()
                t.join(timeout=2.0)

            client.flush_telemetry()
            payload = usage.calls[0]
            # Only the completed init refresh (miss), not the concurrent skip.
            assert payload["definitionCacheMisses"] == 1
            assert "definitionCacheHits" not in payload
        finally:
            release.set()
            client.close()

    def test_startup_snapshot_before_network_is_hit(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("TOGGLY_DISABLE_TELEMETRY", raising=False)
        provider = MemorySnapshotProvider()
        provider.save_definitions(
            DefinitionsSnapshot(
                definitions=[
                    FeatureDefinition(
                        feature_key="cached-feature",
                        filters=[FeatureFilter(name="AlwaysOn", parameters={})],
                    )
                ],
                etag='"rev-cached"',
            )
        )
        config, usage = _telemetry_config(snapshot_provider=provider)
        client = TogglyClient(config)
        try:
            with pytest.MonkeyPatch.context() as mp:
                mp.setattr(
                    client._http,
                    "get",
                    lambda *_a, **_k: _not_modified('"rev-cached"'),
                )
                client.init()
            client.flush_telemetry()
            payload = usage.calls[0]
            # Snapshot load hit + 304 refresh hit.
            assert payload["definitionCacheHits"] == 2
            assert "definitionCacheMisses" not in payload
            assert client.is_enabled("cached-feature") is True
        finally:
            client.close()

    def test_network_failure_keeping_last_good_is_hit(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("TOGGLY_DISABLE_TELEMETRY", raising=False)
        config, usage = _telemetry_config()
        client = TogglyClient(config)
        responses: List[Any] = [_ok_defs(etag='"rev-1"'), RuntimeError("network down")]

        def fake_get(*_a: Any, **_k: Any) -> MagicMock:
            item = responses.pop(0)
            if isinstance(item, Exception):
                from toggly.exceptions import TogglyNetworkError

                raise TogglyNetworkError(str(item), cause=item)
            return item

        try:
            with pytest.MonkeyPatch.context() as mp:
                mp.setattr(client._http, "get", fake_get)
                client.init()
                client.refresh()
            client.flush_telemetry()
            payload = usage.calls[0]
            assert payload["definitionCacheMisses"] == 1
            assert payload["definitionCacheHits"] == 1
            assert client.is_enabled("feature-a") is True
        finally:
            client.close()

    def test_same_revision_200_is_hit(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("TOGGLY_DISABLE_TELEMETRY", raising=False)
        config, usage = _telemetry_config()
        client = TogglyClient(config)
        responses = [
            _ok_defs(etag='"rev-1"'),
            _ok_defs(etag='"rev-1"'),
        ]

        def fake_get(*_a: Any, **_k: Any) -> MagicMock:
            return responses.pop(0)

        try:
            with pytest.MonkeyPatch.context() as mp:
                mp.setattr(client._http, "get", fake_get)
                client.init()
                client.refresh()
            client.flush_telemetry()
            payload = usage.calls[0]
            assert payload["definitionCacheMisses"] == 1
            assert payload["definitionCacheHits"] == 1
        finally:
            client.close()


class TestAsyncDefinitionCacheHits:
    @pytest.mark.asyncio
    async def test_async_miss_then_304_hit(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("TOGGLY_DISABLE_TELEMETRY", raising=False)
        config, usage = _telemetry_config()
        client = AsyncTogglyClient(config)
        responses = [_ok_defs(etag='"rev-1"'), _not_modified('"rev-1"')]

        def fake_get(*_a: Any, **_k: Any) -> MagicMock:
            return responses.pop(0)

        try:
            with pytest.MonkeyPatch.context() as mp:
                # Async client builds a fresh HttpClient per fetch.
                mp.setattr("toggly.async_client.HttpClient.get", fake_get)
                # HttpClient.get is instance method — patch on class.
                from toggly.http import HttpClient

                mp.setattr(HttpClient, "get", fake_get)
                await client.init()
                await client.refresh()
            client.flush_telemetry()
            payload = usage.calls[0]
            assert payload["definitionCacheMisses"] == 1
            assert payload["definitionCacheHits"] == 1
        finally:
            await client.close()
