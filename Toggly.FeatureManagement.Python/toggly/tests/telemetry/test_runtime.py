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

    def test_restores_full_usage_batch_when_send_stats_fails_then_succeeds(self) -> None:
        class FlakyUsageClient:
            def __init__(self) -> None:
                self.calls: List[Dict[str, Any]] = []
                self._fail_once = True

            def send_stats(
                self,
                request: Dict[str, Any],
                metadata: Optional[Dict[str, str]] = None,
            ) -> Dict[str, Any]:
                self.calls.append(request)
                if self._fail_once:
                    self._fail_once = False
                    raise RuntimeError("transient send failure")
                return {"featureCount": 1}

            def close(self) -> None:
                pass

        usage = FlakyUsageClient()
        runtime = TelemetryRuntime(
            app_key="app",
            environment="Production",
            enable_usage_tracking=True,
            enable_metrics=False,
            usage_flush_interval=0,
            metrics_flush_interval=0,
            usage_client=usage,
            metrics_client=None,
            usage_client_provided=True,
            metrics_client_provided=True,
        )
        runtime.start()
        runtime.record_check("FeatureA", True, "user-1")
        runtime.record_definition_cache_hit()
        runtime.record_definition_cache_miss()

        runtime.flush_usage()
        assert len(usage.calls) == 1

        runtime.flush_usage()
        assert len(usage.calls) == 2
        payload = usage.calls[1]
        assert payload["definitionCacheHits"] == 1
        assert payload["definitionCacheMisses"] == 1
        assert payload["stats"][0]["feature"] == "FeatureA"
        assert payload["stats"][0]["variantStats"]["enabled"]["checkCount"] == 1
        runtime.close()

    def test_merges_in_flight_records_when_restoring_failed_usage_flush(self) -> None:
        class GateUsageClient:
            def __init__(self) -> None:
                self.calls: List[Dict[str, Any]] = []
                self._first = True
                self.on_first: Any = None

            def send_stats(
                self,
                request: Dict[str, Any],
                metadata: Optional[Dict[str, str]] = None,
            ) -> Dict[str, Any]:
                self.calls.append(request)
                if self._first:
                    self._first = False
                    if self.on_first is not None:
                        self.on_first()
                    raise RuntimeError("send failed")
                return {"featureCount": 1}

            def close(self) -> None:
                pass

        usage = GateUsageClient()
        runtime = TelemetryRuntime(
            app_key="app",
            environment="Production",
            enable_usage_tracking=True,
            enable_metrics=False,
            usage_flush_interval=0,
            metrics_flush_interval=0,
            usage_client=usage,
            metrics_client=None,
            usage_client_provided=True,
            metrics_client_provided=True,
        )
        runtime.start()
        runtime.record_check("FeatureA", True, "user-1")
        runtime.record_definition_cache_hit()

        def during_send() -> None:
            runtime.record_check("FeatureB", False, "user-2")
            runtime.record_definition_cache_hit()

        usage.on_first = during_send
        runtime.flush_usage()
        runtime.flush_usage()

        assert len(usage.calls) == 2
        payload = usage.calls[1]
        assert payload["definitionCacheHits"] == 2
        by_feature = {
            s["feature"]: s["variantStats"] for s in payload["stats"]
        }
        assert by_feature["FeatureA"]["enabled"]["checkCount"] == 1
        assert by_feature["FeatureB"]["disabled"]["checkCount"] == 1
        runtime.close()

    def test_close_during_failed_send_does_not_throw(self) -> None:
        held: Dict[str, Any] = {}

        class ClearOnSendClient:
            def send_stats(
                self,
                request: Dict[str, Any],
                metadata: Optional[Dict[str, str]] = None,
            ) -> Dict[str, Any]:
                held["batcher"] = runtime._usage_batcher
                runtime._usage_batcher = None
                raise RuntimeError("send failed after close")

            def close(self) -> None:
                pass

        usage = ClearOnSendClient()
        runtime = TelemetryRuntime(
            app_key="app",
            environment="Production",
            enable_usage_tracking=True,
            enable_metrics=False,
            usage_flush_interval=0,
            metrics_flush_interval=0,
            usage_client=usage,
            metrics_client=None,
            usage_client_provided=True,
            metrics_client_provided=True,
        )
        runtime.start()
        runtime.record_check("FeatureA", True, "user-1")
        runtime.record_definition_cache_hit()

        runtime.flush_usage()  # must not raise

        batcher = held["batcher"]
        restored = batcher.build_and_reset()
        assert restored is not None
        assert restored["definitionCacheHits"] == 1
        assert restored["stats"][0]["variantStats"]["enabled"]["checkCount"] == 1
        runtime.close()
