"""Client wiring for usage/metrics telemetry."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import pytest

from toggly import AsyncTogglyClient, TogglyClient, TogglyConfig


class FakeUsageClient:
    def __init__(self) -> None:
        self.calls: List[Dict[str, Any]] = []

    def send_stats(
        self,
        request: Dict[str, Any],
        metadata: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        self.calls.append(request)
        return {"featureCount": 1}

    def close(self) -> None:
        pass


class FakeMetricsClient:
    def __init__(self) -> None:
        self.calls: List[Dict[str, Any]] = []

    def send_metrics(
        self,
        request: Dict[str, Any],
        metadata: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        self.calls.append(request)
        return {"count": 1}

    def close(self) -> None:
        pass


class TestClientTelemetry:
    def test_is_enabled_records_check_when_usage_enabled(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("TOGGLY_DISABLE_TELEMETRY", raising=False)
        usage = FakeUsageClient()
        metrics = FakeMetricsClient()
        config = TogglyConfig(
            app_key="app",
            environment="Production",
            feature_defaults={"FeatureA": True},
            enable_usage_tracking=True,
            enable_metrics=True,
            usage_flush_interval=0,
            metrics_flush_interval=0,
            usage_client=usage,
            metrics_client=metrics,
            disable_background_refresh=True,
            enable_live_updates=False,
            register_contexts_on_startup=False,
        )
        client = TogglyClient(config)
        assert client.is_enabled("FeatureA", default=False) is True
        client.record_usage("FeatureA")
        client.record_view("FeatureA")
        client.measure("revenue", 3.5, {"feature": "FeatureA", "variant": "enabled"})
        client.increment_counter("clicks", 1.0)
        client.observe("latency", 12.0)
        client.flush_telemetry()

        assert len(usage.calls) == 1
        vs = usage.calls[0]["stats"][0]["variantStats"]["enabled"]
        assert vs["checkCount"] == 1
        assert vs["usedCount"] == 1
        assert vs["viewedCount"] == 1
        assert len(metrics.calls) == 1
        assert metrics.calls[0]["stats"][0]["metric"] == "revenue"
        assert metrics.calls[0]["counters"][0]["metric"] == "clicks"
        assert metrics.calls[0]["observations"][0]["metric"] == "latency"
        client.close()

    def test_usage_disabled_skips_recording(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("TOGGLY_DISABLE_TELEMETRY", raising=False)
        usage = FakeUsageClient()
        config = TogglyConfig(
            app_key="app",
            feature_defaults={"FeatureA": True},
            enable_usage_tracking=False,
            enable_metrics=False,
            usage_client=usage,
            metrics_client=FakeMetricsClient(),
            disable_background_refresh=True,
            enable_live_updates=False,
            register_contexts_on_startup=False,
        )
        client = TogglyClient(config)
        assert client.is_enabled("FeatureA") is True
        client.flush_telemetry()
        assert usage.calls == []
        client.close()


class TestAsyncClientTelemetry:
    @pytest.mark.asyncio
    async def test_async_client_records_usage_and_metrics(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("TOGGLY_DISABLE_TELEMETRY", raising=False)
        usage = FakeUsageClient()
        metrics = FakeMetricsClient()
        config = TogglyConfig(
            app_key="app",
            environment="Production",
            feature_defaults={"FeatureA": True},
            enable_usage_tracking=True,
            enable_metrics=True,
            usage_flush_interval=0,
            metrics_flush_interval=0,
            usage_client=usage,
            metrics_client=metrics,
            disable_background_refresh=True,
            enable_live_updates=False,
            register_contexts_on_startup=False,
        )
        client = AsyncTogglyClient(config)
        assert await client.is_enabled("FeatureA", default=False) is True
        client.record_usage("FeatureA")
        client.record_view("FeatureA")
        client.increment_counter("clicks", 2.0, {"feature": "FeatureA"})
        client.observe("gauge", 9.0, {"feature": "FeatureA", "variant": "enabled"})
        client.flush_telemetry()

        assert len(usage.calls) == 1
        vs = usage.calls[0]["stats"][0]["variantStats"]["enabled"]
        assert vs["checkCount"] == 1
        assert vs["usedCount"] == 1
        assert vs["viewedCount"] == 1
        assert len(metrics.calls) == 1
        assert metrics.calls[0]["counters"][0]["metric"] == "clicks"
        assert metrics.calls[0]["observations"][0]["metric"] == "gauge"
        await client.close()
