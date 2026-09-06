"""Tests for TelemetryRuntime flush behavior."""

from __future__ import annotations

import time
from typing import Any, Dict, List, Optional

from toggly.telemetry import TelemetryRuntime


class FakeUsageClient:
    def __init__(self) -> None:
        self.calls: List[Dict[str, Any]] = []
        self.closed = False

    def send_stats(
        self,
        request: Dict[str, Any],
        metadata: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        self.calls.append({"request": request, "metadata": metadata})
        return {"featureCount": 1}

    def close(self) -> None:
        self.closed = True


class FakeMetricsClient:
    def __init__(self) -> None:
        self.calls: List[Dict[str, Any]] = []
        self.closed = False

    def send_metrics(
        self,
        request: Dict[str, Any],
        metadata: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        self.calls.append({"request": request, "metadata": metadata})
        return {"count": 1}

    def close(self) -> None:
        self.closed = True


class IncompleteUsageClient:
    def close(self) -> None:
        pass


class TestTelemetryRuntime:
    def test_flushes_usage_and_metrics_via_injected_clients(self) -> None:
        usage = FakeUsageClient()
        metrics = FakeMetricsClient()
        runtime = TelemetryRuntime(
            app_key="app",
            environment="Production",
            enable_usage_tracking=True,
            enable_metrics=True,
            usage_flush_interval=0,
            metrics_flush_interval=0,
            usage_client=usage,
            metrics_client=metrics,
            usage_client_provided=True,
            metrics_client_provided=True,
        )
        runtime.start()

        runtime.record_check("FeatureA", True, "user-1")
        runtime.record_usage("FeatureA", "user-1")
        runtime.measure("revenue", 9)
        runtime.increment_counter("clicks")
        runtime.observe("depth", 2)

        runtime.flush_all()

        assert len(usage.calls) == 1
        usage_payload = usage.calls[0]["request"]
        assert usage_payload["stats"][0]["feature"] == "FeatureA"
        assert usage_payload["stats"][0]["variantStats"]["enabled"]["checkCount"] == 1

        assert len(metrics.calls) == 1
        metrics_payload = metrics.calls[0]["request"]
        assert metrics_payload["stats"][0]["metric"] == "revenue"
        assert metrics_payload["counters"][0]["metric"] == "clicks"
        assert metrics_payload["observations"][0]["metric"] == "depth"

        runtime.close()
        assert usage.closed
        assert metrics.closed

    def test_auto_flushes_on_interval(self) -> None:
        usage = FakeUsageClient()
        metrics = FakeMetricsClient()
        runtime = TelemetryRuntime(
            app_key="app",
            environment="Production",
            enable_usage_tracking=True,
            enable_metrics=False,
            usage_flush_interval=0.05,
            metrics_flush_interval=0,
            usage_client=usage,
            metrics_client=metrics,
            usage_client_provided=True,
            metrics_client_provided=True,
        )
        runtime.start()
        runtime.record_check("FeatureA", True)

        deadline = time.time() + 2.0
        while time.time() < deadline and not usage.calls:
            time.sleep(0.02)

        assert usage.calls
        runtime.close()

    def test_retains_usage_batch_when_flush_has_no_send_stats(self) -> None:
        usage = FakeUsageClient()
        runtime = TelemetryRuntime(
            app_key="app",
            environment="Production",
            enable_usage_tracking=True,
            enable_metrics=False,
            usage_flush_interval=0,
            metrics_flush_interval=0,
            usage_client=IncompleteUsageClient(),
            metrics_client=None,
            usage_client_provided=True,
            metrics_client_provided=True,
        )
        runtime.start()
        runtime.record_check("FeatureA", True, "user-1")

        runtime.flush_usage()
        assert not usage.calls

        # Attach a working client — prior observations must still be present.
        runtime._clients.usage = usage  # type: ignore[union-attr]
        runtime.flush_usage()
        assert len(usage.calls) == 1
        assert usage.calls[0]["request"]["stats"][0]["variantStats"]["enabled"][
            "checkCount"
        ] == 1
        runtime.close()

    def test_retains_metrics_batch_when_flush_has_no_send_metrics(self) -> None:
        metrics = FakeMetricsClient()
        runtime = TelemetryRuntime(
            app_key="app",
            environment="Production",
            enable_usage_tracking=False,
            enable_metrics=True,
            usage_flush_interval=0,
            metrics_flush_interval=0,
            usage_client=None,
            metrics_client=IncompleteUsageClient(),
            usage_client_provided=True,
            metrics_client_provided=True,
        )
        runtime.start()
        runtime.measure("revenue", 9)

        runtime.flush_metrics()
        assert not metrics.calls

        runtime._clients.metrics = metrics  # type: ignore[union-attr]
        runtime.flush_metrics()
        assert len(metrics.calls) == 1
        runtime.close()
