"""Tests for opt-in system metrics collector."""

from __future__ import annotations

import sys
import threading
from types import SimpleNamespace

import pytest

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

    def test_skips_non_finite_and_sampler_errors(self) -> None:
        observed: list[float] = []
        values = iter(
            [
                [SystemMetricObservation("CpuUsage", float("nan"))],
                [SystemMetricObservation("CpuUsage", float("inf"))],
                RuntimeError("boom"),
                [SystemMetricObservation("CpuUsage", 3.0)],
            ]
        )

        def sampler():
            item = next(values)
            if isinstance(item, Exception):
                raise item
            return item

        collector = SystemMetricsCollector(
            lambda _metric, value: observed.append(value),
            interval_seconds=0,
            sampler=sampler,
        )
        collector.start()
        collector.tick()
        collector.tick()
        collector.tick()
        collector.tick()
        assert observed == [3.0]
        collector.stop()

    def test_double_start_and_stop_are_idempotent(self) -> None:
        collector = SystemMetricsCollector(
            lambda _m, _v: None,
            interval_seconds=60.0,
            sampler=lambda: [],
        )
        collector.start()
        collector.start()
        assert collector._started is True
        collector.stop()
        collector.stop()
        assert collector._started is False

    def test_default_sampler_emits_cpu_memory_and_exceptions(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        import toggly.telemetry.system_metrics as sm

        class FakeResource:
            RUSAGE_SELF = 0

            def getrusage(self, _who: int) -> SimpleNamespace:
                return SimpleNamespace(ru_utime=1.0, ru_stime=1.0, ru_maxrss=2048)

        fake = FakeResource()
        monkeypatch.setattr(sm, "_resource", fake)
        monkeypatch.setattr(
            SystemMetricsCollector,
            "_sample_linux_vm_rss_bytes",
            staticmethod(lambda: 8192.0),
        )
        clock = {"t": 100.0}

        def mono() -> float:
            return clock["t"]

        collector = SystemMetricsCollector(
            lambda _metric, _value: None,
            interval_seconds=60.0,
            monotonic=mono,
        )
        collector.start()
        assert collector._last_cpu_seconds == 2.0

        # Advance wall clock and CPU seconds for a measurable percent.
        def getrusage(_who: int) -> SimpleNamespace:
            return SimpleNamespace(ru_utime=2.0, ru_stime=2.0, ru_maxrss=4096)

        monkeypatch.setattr(fake, "getrusage", getrusage)
        clock["t"] = 102.0
        collector._exception_count = 2
        samples = collector._default_sample()
        names = {s.metric: s.value for s in samples}
        assert "CpuUsage" in names
        assert 0.0 <= names["CpuUsage"] <= 100.0
        assert names["MemoryWorkingSet"] == 8192.0
        assert names["ExceptionCount"] == 2.0
        assert collector._exception_count == 0
        collector.stop()

    def test_cpu_sample_edge_cases(self, monkeypatch: pytest.MonkeyPatch) -> None:
        import toggly.telemetry.system_metrics as sm

        class FakeResource:
            RUSAGE_SELF = 0

            def getrusage(self, _who: int) -> SimpleNamespace:
                return SimpleNamespace(ru_utime=5.0, ru_stime=0.0, ru_maxrss=1)

        monkeypatch.setattr(sm, "_resource", FakeResource())
        clock = {"t": 10.0}
        collector = SystemMetricsCollector(
            lambda _m, _v: None,
            interval_seconds=60.0,
            monotonic=lambda: clock["t"],
        )
        collector.start()

        # Non-positive wall delta.
        assert collector._sample_cpu_percent() is None

        clock["t"] = 11.0
        collector._last_cpu_seconds = 10.0  # delta would be negative
        assert collector._sample_cpu_percent() is None

        collector._last_cpu_seconds = 4.0
        collector._last_cpu_at = 10.0
        clock["t"] = 12.0
        pct = collector._sample_cpu_percent()
        assert pct is not None
        assert 0.0 <= pct <= 100.0
        collector.stop()

    def test_memory_sample_linux_vmrss_and_omit_elsewhere(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path
    ) -> None:
        import toggly.telemetry.system_metrics as sm

        status = tmp_path / "status"
        status.write_text("Name:\tpython\nVmRSS:\t2048 kB\n", encoding="utf-8")
        monkeypatch.setattr(sm.sys, "platform", "linux")
        real_open = open

        def fake_open(path, *args, **kwargs):
            if str(path) == "/proc/self/status":
                return real_open(status, *args, **kwargs)
            return real_open(path, *args, **kwargs)

        monkeypatch.setattr("builtins.open", fake_open)
        assert SystemMetricsCollector._sample_memory_working_set_bytes() == 2048.0 * 1024.0

        monkeypatch.setattr(sm.sys, "platform", "darwin")
        assert SystemMetricsCollector._sample_memory_working_set_bytes() is None

    def test_exception_hooks_increment_and_restore(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        noop_sys = lambda *_args: None
        noop_thread = lambda *_args: None
        monkeypatch.setattr(sys, "excepthook", noop_sys)
        if hasattr(threading, "excepthook"):
            monkeypatch.setattr(threading, "excepthook", noop_thread)

        collector = SystemMetricsCollector(
            lambda _metric, _value: None,
            interval_seconds=60.0,
            sampler=lambda: [],
        )
        collector.start()
        assert sys.excepthook is not noop_sys
        try:
            raise RuntimeError("sys-hook")
        except RuntimeError:
            sys.excepthook(*sys.exc_info())
        assert collector._exception_count == 1

        if hasattr(threading, "excepthook"):
            args = SimpleNamespace(
                exc_type=RuntimeError,
                exc_value=RuntimeError("thread"),
                exc_traceback=None,
                thread=None,
            )
            threading.excepthook(args)  # type: ignore[arg-type]
            assert collector._exception_count == 2

        collector.stop()
        assert sys.excepthook is noop_sys
        if hasattr(threading, "excepthook"):
            assert threading.excepthook is noop_thread


def test_start_without_resource_module(monkeypatch: pytest.MonkeyPatch) -> None:
    """Collector starts on hosts without POSIX resource (coverage / Windows)."""
    import toggly.telemetry.system_metrics as sm

    monkeypatch.setattr(sm, "_resource", None)
    # MemoryWorkingSet uses /proc VmRSS independently of resource; force omit.
    monkeypatch.setattr(
        SystemMetricsCollector,
        "_sample_linux_vm_rss_bytes",
        staticmethod(lambda: None),
    )
    c = sm.SystemMetricsCollector(lambda m, v: None, interval_seconds=60.0)
    c.start()
    assert c._sample_cpu_percent() is None
    assert sm.SystemMetricsCollector._sample_memory_working_set_bytes() is None
    c.tick()
    c.stop()
    assert c._started is False


def test_scheduler_reschedules_while_started(monkeypatch: pytest.MonkeyPatch) -> None:
    """Cover Timer scheduling path without waiting on real intervals."""
    fired: list[object] = []

    class ImmediateTimer:
        def __init__(self, _interval: float, fn: object) -> None:
            self._fn = fn
            self.daemon = False

        def start(self) -> None:
            fired.append(self._fn)

        def cancel(self) -> None:
            return None

    monkeypatch.setattr("toggly.telemetry.system_metrics.threading.Timer", ImmediateTimer)
    ticks = {"n": 0}

    def sampler():
        ticks["n"] += 1
        return [SystemMetricObservation("CpuUsage", 1.0)]

    collector = SystemMetricsCollector(
        lambda _m, _v: None,
        interval_seconds=0.01,
        sampler=sampler,
    )
    collector.start()
    assert fired, "expected a scheduled timer callback"
    # Run the scheduled callback once; it should tick and reschedule.
    callback = fired[0]
    assert callable(callback)
    callback()
    assert ticks["n"] == 1
    assert len(fired) == 2
    collector.stop()
