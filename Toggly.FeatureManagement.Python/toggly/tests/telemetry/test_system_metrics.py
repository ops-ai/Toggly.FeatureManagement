"""Tests for opt-in system metrics collector."""

from __future__ import annotations

from toggly.telemetry.system_metrics import (
    SYSTEM_METRICS_MAX_PENDING,
    SystemMetricObservation,
    SystemMetricsCollector,
)


class TestSystemMetricsCollector:
    def test_emits_sampler_values_and_stops(self) -> None:
        observed: list[SystemMetricObservation] = []

        collector = SystemMetricsCollector(
            lambda metric, value: observed.append(
                SystemMetricObservation(metric, value)
            ),
            interval_seconds=10.0,
            sampler=lambda: [
                SystemMetricObservation("CpuUsage", 12.5),
                SystemMetricObservation("MemoryWorkingSet", 4096.0),
            ],
        )
        collector.start()
        collector.tick()
        assert observed == [
            SystemMetricObservation("CpuUsage", 12.5),
            SystemMetricObservation("MemoryWorkingSet", 4096.0),
        ]
        collector.stop()
        before = len(observed)
        collector.tick()
        assert len(observed) == before

    def test_pending_cap_cleared_on_flush(self) -> None:
        observed: list[str] = []
        collector = SystemMetricsCollector(
            lambda metric, _value: observed.append(metric),
            interval_seconds=10.0,
            sampler=lambda: [SystemMetricObservation("CpuUsage", 1.0)],
        )
        collector.start()
        for _ in range(SYSTEM_METRICS_MAX_PENDING + 5):
            collector.tick()
        assert len(observed) == SYSTEM_METRICS_MAX_PENDING
        collector.on_flushed()
        collector.tick()
        assert len(observed) == SYSTEM_METRICS_MAX_PENDING + 1
        collector.stop()


def test_start_without_resource_module(monkeypatch):
    """Collector starts on hosts without POSIX resource (coverage / Windows)."""
    import toggly.telemetry.system_metrics as sm

    monkeypatch.setattr(sm, "_resource", None)
    c = sm.SystemMetricsCollector(lambda m, v: None, interval_seconds=60.0)
    c.start()
    c.tick()
    c.stop()
    assert c._started is False
