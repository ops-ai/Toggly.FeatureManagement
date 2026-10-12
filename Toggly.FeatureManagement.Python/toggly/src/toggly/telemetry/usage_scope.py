"""Feature usage scope (attempt + duration + errors)."""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Protocol, TypeVar

T = TypeVar("T")


class FeatureUsageScope(Protocol):
    """Tracks one usage attempt; call ``fail()`` to mark failure without raising."""

    def fail(self) -> None:
        """Mark the scope as failed (counted once on completion)."""


@dataclass
class _ScopeState:
    failed: bool = False


class _ScopeImpl:
    def __init__(self) -> None:
        self._state = _ScopeState()

    def fail(self) -> None:
        self._state.failed = True


def is_usage_cancellation(exc: BaseException) -> bool:
    """Return True when *exc* represents cancellation (no error/duration)."""
    return isinstance(exc, asyncio.CancelledError)


def _elapsed_ms(start: float) -> int:
    return max(0, int(round((time.monotonic() - start) * 1000)))


def run_usage_scope(
    handlers: tuple[
        Callable[[], None],
        Callable[[int], None],
        Callable[[int], None],
    ],
    fn: Callable[[FeatureUsageScope], T],
) -> T:
    """Run *fn* inside a usage scope (sync)."""
    record_attempt, record_success_duration, record_failure = handlers
    record_attempt()
    start = time.monotonic()
    scope = _ScopeImpl()
    try:
        result = fn(scope)
    except BaseException as exc:
        if is_usage_cancellation(exc):
            raise
        record_failure(_elapsed_ms(start))
        raise
    duration_ms = _elapsed_ms(start)
    if scope._state.failed:
        record_failure(duration_ms)
    else:
        record_success_duration(duration_ms)
    return result


async def run_usage_scope_async(
    handlers: tuple[
        Callable[[], None],
        Callable[[int], None],
        Callable[[int], None],
    ],
    fn: Callable[[FeatureUsageScope], Awaitable[T]],
) -> T:
    """Run awaitable work inside a usage scope (async)."""
    record_attempt, record_success_duration, record_failure = handlers
    record_attempt()
    start = time.monotonic()
    scope = _ScopeImpl()
    try:
        result = await fn(scope)
    except BaseException as exc:
        if is_usage_cancellation(exc):
            raise
        record_failure(_elapsed_ms(start))
        raise
    duration_ms = _elapsed_ms(start)
    if scope._state.failed:
        record_failure(duration_ms)
    else:
        record_success_duration(duration_ms)
    return result
