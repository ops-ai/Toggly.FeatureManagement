"""Opt-in process system metrics (stdlib only)."""

from __future__ import annotations

import math
import os
import sys
import threading
import time
from dataclasses import dataclass
from types import TracebackType
from types import ModuleType
from typing import Callable, Optional, Protocol, cast

try:
    import resource as _resource_mod
except ImportError:  # Windows / non-POSIX
    _resource_mod = None

_resource: Optional[ModuleType] = _resource_mod

SYSTEM_METRICS_INTERVAL_SECONDS = 10.0
SYSTEM_METRICS_MAX_PENDING = 30


@dataclass(frozen=True)
class SystemMetricObservation:
    """One sampled system metric."""

    metric: str
    value: float


class SystemMetricsSampler(Protocol):
    """Callable that returns the current process metric samples."""

    def __call__(self) -> list[SystemMetricObservation]:
        """Return observations for one sample tick."""
        ...


ObserveFn = Callable[[str, float], None]


class SystemMetricsCollector:
    """CpuUsage, MemoryWorkingSet, ExceptionCount (uncaught). No GC metrics."""

    def __init__(
        self,
        observe: ObserveFn,
        *,
        interval_seconds: float = SYSTEM_METRICS_INTERVAL_SECONDS,
        sampler: Optional[SystemMetricsSampler] = None,
        monotonic: Optional[Callable[[], float]] = None,
    ) -> None:
        """Create a collector that posts samples through ``observe``."""
        self._observe = observe
        self._interval_seconds = (
            interval_seconds
            if interval_seconds > 0
            else SYSTEM_METRICS_INTERVAL_SECONDS
        )
        self._sampler = sampler or self._default_sample
        self._monotonic = monotonic or time.monotonic
        self._timer: Optional[threading.Timer] = None
        self._started = False
        self._exception_count = 0
        self._pending_by_metric: dict[str, int] = {}
        self._previous_sys_excepthook: Optional[Callable[..., None]] = None
        self._previous_thread_excepthook: Optional[Callable[..., None]] = None
        self._last_cpu_seconds: Optional[float] = None
        self._last_cpu_at: Optional[float] = None

    def start(self) -> None:
        """Begin periodic sampling and attach uncaught-exception hooks."""
        if self._started:
            return
        self._started = True
        if _resource is not None:
            usage = _resource.getrusage(_resource.RUSAGE_SELF)
            self._last_cpu_seconds = usage.ru_utime + usage.ru_stime
            self._last_cpu_at = self._monotonic()
        self._attach_exception_hooks()
        self._schedule_tick()

    def stop(self) -> None:
        """Stop sampling and restore prior exception hooks."""
        if not self._started:
            return
        self._started = False
        if self._timer is not None:
            self._timer.cancel()
            self._timer = None
        self._detach_exception_hooks()
        self._pending_by_metric.clear()

    def tick(self) -> None:
        """Run one sample cycle (also used by tests)."""
        if not self._started:
            return
        try:
            for sample in self._sampler():
                value = float(sample.value)
                if not math.isfinite(value):
                    continue
                pending = self._pending_by_metric.get(sample.metric, 0)
                if pending >= SYSTEM_METRICS_MAX_PENDING:
                    continue
                self._pending_by_metric[sample.metric] = pending + 1
                self._observe(sample.metric, value)
        except Exception:
            pass

    def on_flushed(self) -> None:
        """Clear pending-observation backpressure after a successful flush."""
        self._pending_by_metric.clear()

    def _schedule_tick(self) -> None:
        if not self._started:
            return

        def _run() -> None:
            try:
                self.tick()
            finally:
                if self._started:
                    self._schedule_tick()

        timer = threading.Timer(self._interval_seconds, _run)
        timer.daemon = True
        self._timer = timer
        timer.start()

    def _default_sample(self) -> list[SystemMetricObservation]:
        out: list[SystemMetricObservation] = []

        cpu = self._sample_cpu_percent()
        if cpu is not None:
            out.append(SystemMetricObservation("CpuUsage", cpu))

        memory = self._sample_memory_working_set_bytes()
        if memory is not None:
            out.append(SystemMetricObservation("MemoryWorkingSet", memory))

        if self._exception_count > 0:
            count = self._exception_count
            self._exception_count = 0
            out.append(SystemMetricObservation("ExceptionCount", float(count)))

        return out

    def _sample_cpu_percent(self) -> Optional[float]:
        if _resource is None:
            return None
        usage = _resource.getrusage(_resource.RUSAGE_SELF)
        cpu_seconds = usage.ru_utime + usage.ru_stime
        now = self._monotonic()
        prev_seconds = self._last_cpu_seconds
        prev_at = self._last_cpu_at
        self._last_cpu_seconds = cpu_seconds
        self._last_cpu_at = now
        if prev_seconds is None or prev_at is None:
            return None
        wall = now - prev_at
        if wall <= 0:
            return None
        delta = cpu_seconds - prev_seconds
        if delta < 0:
            return None
        processors = max(1, (os.cpu_count() or 1))
        pct = (delta / wall / processors) * 100.0
        if pct < 0 or not math.isfinite(pct):
            return None
        return min(100.0, pct)

    @staticmethod
    def _sample_memory_working_set_bytes() -> Optional[float]:
        if _resource is None:
            return None
        try:
            usage = _resource.getrusage(_resource.RUSAGE_SELF)
            rss = float(usage.ru_maxrss)
            if rss < 0:
                return None
            if sys.platform == "darwin":
                return rss
            return rss * 1024.0
        except Exception:
            return None

    def _attach_exception_hooks(self) -> None:
        previous_sys = sys.excepthook

        def sys_hook(
            exc_type: type[BaseException],
            exc: BaseException,
            tb: Optional[TracebackType],
        ) -> None:
            self._exception_count += 1
            previous_sys(exc_type, exc, tb)

        self._previous_sys_excepthook = previous_sys
        sys.excepthook = sys_hook

        if not hasattr(threading, "excepthook"):
            return
        previous_thread = threading.excepthook

        def thread_hook(args: threading.ExceptHookArgs) -> None:
            self._exception_count += 1
            previous_thread(args)

        self._previous_thread_excepthook = cast(Optional[Callable[..., None]], previous_thread)
        threading.excepthook = thread_hook  # type: ignore[attr-defined, assignment]

    def _detach_exception_hooks(self) -> None:
        if self._previous_sys_excepthook is not None:
            sys.excepthook = self._previous_sys_excepthook
            self._previous_sys_excepthook = None
        if self._previous_thread_excepthook is not None:
            threading.excepthook = self._previous_thread_excepthook  # type: ignore[attr-defined, assignment]
            self._previous_thread_excepthook = None
