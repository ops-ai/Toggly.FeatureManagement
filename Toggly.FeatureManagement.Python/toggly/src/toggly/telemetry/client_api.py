"""Shared sync telemetry surface for :class:`TogglyClient` / AsyncTogglyClient."""

from __future__ import annotations

import os
from typing import Any, Mapping, Optional

from toggly.config import TogglyConfig
from toggly.telemetry.runtime import TelemetryRuntime


class TelemetryClientMixin:
    """Public usage/metrics helpers shared by sync and async clients.

    Expects subclasses to provide ``_config``, ``_identity``, and ``_telemetry``.
    """

    _config: TogglyConfig
    _identity: Optional[str]
    _telemetry: Optional[TelemetryRuntime]

    def record_usage(
        self,
        feature_key: str,
        identity: Optional[str] = None,
        variant: str = "enabled",
    ) -> None:
        """Record a feature used/interaction event."""
        if self._telemetry is None or not self._telemetry.usage_enabled:
            return
        self._telemetry.record_usage(
            feature_key,
            identity if identity is not None else self._identity,
            variant,
        )

    def record_view(
        self,
        feature_key: str,
        identity: Optional[str] = None,
        variant: str = "enabled",
    ) -> None:
        """Record a feature viewed/rendered event."""
        if self._telemetry is None or not self._telemetry.usage_enabled:
            return
        self._telemetry.record_view(
            feature_key,
            identity if identity is not None else self._identity,
            variant,
        )

    def measure(
        self,
        metric: str,
        value: float,
        options: Optional[Mapping[str, Any]] = None,
    ) -> None:
        """Aggregate a business measurement (sum over the flush window)."""
        if self._telemetry is None or not self._telemetry.metrics_enabled:
            return
        self._telemetry.measure(metric, value, options)

    def increment_counter(
        self,
        metric: str,
        value: float = 1.0,
        options: Optional[Mapping[str, Any]] = None,
    ) -> None:
        """Increment a business counter."""
        if self._telemetry is None or not self._telemetry.metrics_enabled:
            return
        self._telemetry.increment_counter(metric, value, options)

    def observe(
        self,
        metric: str,
        value: float,
        options: Optional[Mapping[str, Any]] = None,
    ) -> None:
        """Record a point-in-time business observation."""
        if self._telemetry is None or not self._telemetry.metrics_enabled:
            return
        self._telemetry.observe(metric, value, options)

    def flush_telemetry(self) -> None:
        """Flush pending usage and metrics batches."""
        if self._telemetry is not None:
            self._telemetry.flush_all()

    def _record_check(
        self,
        feature_key: str,
        enabled: bool,
        identity: Optional[str],
    ) -> None:
        """Record a feature evaluation check when usage tracking is on."""
        if self._telemetry is None or not self._telemetry.usage_enabled:
            return
        self._telemetry.record_check(feature_key, enabled, identity)

    def _record_definition_cache_hit(self) -> None:
        """Record a definition-refresh cache hit when usage tracking is on."""
        if self._telemetry is None or not self._telemetry.usage_enabled:
            return
        self._telemetry.record_definition_cache_hit()

    def _record_definition_cache_miss(self) -> None:
        """Record a definition-refresh cache miss when usage tracking is on."""
        if self._telemetry is None or not self._telemetry.usage_enabled:
            return
        self._telemetry.record_definition_cache_miss()

    def _record_refresh_cache_outcome(self, outcome: str) -> None:
        """Record one hit or miss for a completed refresh attempt."""
        if outcome == "miss":
            self._record_definition_cache_miss()
        else:
            self._record_definition_cache_hit()

    def _start_telemetry(self) -> None:
        """Create and start a :class:`TelemetryRuntime` from client config."""
        if not self._config.app_key:
            return
        if os.environ.get("TOGGLY_DISABLE_TELEMETRY") == "1":
            return
        if not self._config.enable_usage_tracking and not self._config.enable_metrics:
            return

        usage_provided = self._config.usage_client is not None
        metrics_provided = self._config.metrics_client is not None
        self._telemetry = TelemetryRuntime(
            app_key=self._config.app_key,
            environment=self._config.environment,
            metrics_base_url=self._config.metrics_base_url,
            enable_usage_tracking=self._config.enable_usage_tracking,
            enable_metrics=self._config.enable_metrics,
            usage_flush_interval=self._config.usage_flush_interval,
            metrics_flush_interval=self._config.metrics_flush_interval,
            instance_name=self._config.instance_name,
            app_version=self._config.app_version,
            usage_client=self._config.usage_client,
            metrics_client=self._config.metrics_client,
            usage_client_provided=usage_provided,
            metrics_client_provided=metrics_provided,
        )
        self._telemetry.start()
