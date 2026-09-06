"""In-memory business metrics aggregator (Metrics.SendMetrics payload shape)."""

from __future__ import annotations

import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Mapping

from toggly.telemetry.grpc_clients import to_protobuf_timestamp

MetricKey = tuple[str, str]  # (metric, feature or "")


@dataclass
class MetricsFeatureOptions:
    """Optional feature/variant correlation for a metric sample."""

    feature: str | None = None
    variant: str | None = None


class MetricsBatcher:
    """Accumulate business metrics using ``variantValues`` maps (.NET parity).

    Thread-safe for concurrent record/flush.
    """

    def __init__(
        self,
        app_key: str,
        environment: str,
        *,
        instance_name: str | None = None,
    ) -> None:
        """Create an empty metrics aggregator for one app/environment."""
        self._app_key = app_key
        self._environment = environment
        self._instance_name = instance_name
        self._measures: dict[MetricKey, dict[str, float]] = {}
        self._counters: dict[MetricKey, dict[str, float]] = {}
        self._observations: list[dict[str, Any]] = []
        self._lock = threading.RLock()

    @staticmethod
    def _key(metric: str, feature: str | None) -> MetricKey:
        return (metric, feature or "")

    def _add_to_map(
        self,
        store: dict[MetricKey, dict[str, float]],
        metric: str,
        value: float,
        options: MetricsFeatureOptions | None = None,
    ) -> None:
        variant = "enabled"
        feature: str | None = None
        if options is not None:
            if options.variant:
                variant = options.variant
            feature = options.feature
        map_key = self._key(metric, feature)
        variants = store.get(map_key)
        if variants is None:
            variants = {}
            store[map_key] = variants
        variants[variant] = variants.get(variant, 0.0) + value

    def measure(
        self,
        metric: str,
        value: float,
        options: MetricsFeatureOptions | None = None,
    ) -> None:
        """Aggregate a measurement (sum over the flush window)."""
        with self._lock:
            self._add_to_map(self._measures, metric, value, options)

    def increment_counter(
        self,
        metric: str,
        value: float = 1.0,
        options: MetricsFeatureOptions | None = None,
    ) -> None:
        """Increment a counter."""
        with self._lock:
            self._add_to_map(self._counters, metric, value, options)

    def observe(
        self,
        metric: str,
        value: float,
        options: MetricsFeatureOptions | None = None,
    ) -> None:
        """Record a point-in-time observation (gauge)."""
        with self._lock:
            variant = "enabled"
            feature: str | None = None
            if options is not None:
                if options.variant:
                    variant = options.variant
                feature = options.feature
            self._observations.append(
                {
                    "time": datetime.now(timezone.utc),
                    "metric": metric,
                    "feature": feature,
                    "variant": variant,
                    "value": value,
                }
            )

    def is_empty(self) -> bool:
        """Return True when no metric samples are buffered."""
        with self._lock:
            return not self._measures and not self._counters and not self._observations

    def _drain_map(
        self, store: dict[MetricKey, dict[str, float]]
    ) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for (metric, feature), variants in store.items():
            variant_values = {
                name: value for name, value in variants.items() if value != 0
            }
            if not variant_values:
                continue
            item: dict[str, Any] = {"metric": metric, "variantValues": variant_values}
            if feature:
                item["feature"] = feature
            out.append(item)
        store.clear()
        return out

    def build_and_reset(self) -> dict[str, Any] | None:
        """Build a MetricStat-shaped dict and clear aggregates."""
        with self._lock:
            if not self._measures and not self._counters and not self._observations:
                return None

            # Nanosecond-precise group keys match .NET/Go gauge bags; start a new
            # ObservationMessage when the same variant would overwrite.
            observation_messages: list[dict[str, Any]] = []
            groups: dict[str, dict[str, Any]] = {}
            for obs in self._observations:
                when: datetime = obs["time"]
                group_key = (
                    f"{when.timestamp()}\0{obs['metric']}\0{obs.get('feature') or ''}"
                )
                group = groups.get(group_key)
                if group is None or obs["variant"] in group["variantValues"]:
                    group = {
                        "time": to_protobuf_timestamp(when),
                        "metric": obs["metric"],
                        "variantValues": {},
                    }
                    if obs.get("feature"):
                        group["feature"] = obs["feature"]
                    groups[group_key] = group
                    observation_messages.append(group)
                group["variantValues"][obs["variant"]] = obs["value"]
            self._observations = []

            payload: dict[str, Any] = {
                "appKey": self._app_key,
                "environment": self._environment,
                "time": to_protobuf_timestamp(),
                "stats": self._drain_map(self._measures),
                "counters": self._drain_map(self._counters),
                "observations": observation_messages,
            }
            if self._instance_name:
                payload["instanceName"] = self._instance_name
            return payload


def metrics_options(
    feature: str | None = None,
    variant: str | None = None,
) -> MetricsFeatureOptions:
    """Build a :class:`MetricsFeatureOptions` instance."""
    return MetricsFeatureOptions(feature=feature, variant=variant)


def options_from_mapping(
    options: Mapping[str, Any] | None,
) -> MetricsFeatureOptions | None:
    """Accept dict-style options from public client APIs."""
    if options is None:
        return None
    return MetricsFeatureOptions(
        feature=options.get("feature"),
        variant=options.get("variant"),
    )
