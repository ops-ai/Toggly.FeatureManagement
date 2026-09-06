"""Pytest fixtures for the toggly package."""

from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _disable_telemetry_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep unit tests offline unless a test explicitly enables telemetry."""
    monkeypatch.setenv("TOGGLY_DISABLE_TELEMETRY", "1")
