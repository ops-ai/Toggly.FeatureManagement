"""In-memory business metrics aggregator (Metrics.SendMetrics payload shape)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Mapping, Optional, Tuple

from toggly.telemetry.grpc_clients import to_protobuf_timestamp

MetricKey = Tuple[str, str]  # (metric, feature or "")


@dataclass
class MetricsFeatureOptions:
    """Optional feature/variant correlation for a metric sample."""

    feature: Optional[str] = None
    variant: Optional[str] = None


class MetricsBatcher:
    """Accumulate business metrics using ``variantValues`` maps (.NET parity)."""

    def __init__(
        self,
        app_key: str,
        environment: str,
        *,
        instance_name: Optional[str] = None,
    ) -> None:
        self._app_key = app_key
        self._environment = environment
        self._instance_name = instance_name
        self._measures: Dict[MetricKey, Dict[str, float]] = {}
        self._counters: Dict[MetricKey, Dict[str, float]] = {}
        self._observations: List[Dict[str, Any]] = []

    @staticmethod
    def _key(metric: str, feature: Optional[str]) -> MetricKey:
        return (metric, feature or "")

    def _add_to_map(
        self,
        store: Dict[MetricKey, Dict[str, float]],
        metric: str,
        value: float,
        options: Optional[MetricsFeatureOptions] = None,
    ) -> None:
        variant = "enabled"
        feature: Optional[str] = None
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
        options: Optional[MetricsFeatureOptions] = None,
    ) -> None:
        """Aggregate a measurement (sum over the flush window)."""
        self._add_to_map(self._measures, metric, value, options)

    def increment_counter(
        self,
        metric: str,
        value: float = 1.0,
        options: Optional[MetricsFeatureOptions] = None,
    ) -> None:
        """Increment a counter."""
        self._add_to_map(self._counters, metric, value, options)

    def observe(
        self,
        metric: str,
        value: float,
        options: Optional[MetricsFeatureOptions] = None,
    ) -> None:
        """Record a point-in-time observation (gauge)."""
        variant = "enabled"
        feature: Optional[str] = None
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
        return not self._measures and not self._counters and not self._observations

    def _drain_map(
        self, store: Dict[MetricKey, Dict[str, float]]
    ) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        for (metric, feature), variants in store.items():
            variant_values = {
                name: value for name, value in variants.items() if value != 0
            }
            if not variant_values:
                continue
            item: Dict[str, Any] = {"metric": metric, "variantValues": variant_values}
            if feature:
                item["feature"] = feature
            out.append(item)
        store.clear()
        return out

    def build_and_reset(self) -> Optional[Dict[str, Any]]:
        """Build a MetricStat-shaped dict and clear aggregates."""
        if self.is_empty():
            return None

        observation_groups: Dict[str, Dict[str, Any]] = {}
        for obs in self._observations:
            when: datetime = obs["time"]
            group_key = f"{when.isoformat()}\0{obs['metric']}\0{obs.get('feature') or ''}"
            group = observation_groups.get(group_key)
            if group is None:
                group = {
                    "time": to_protobuf_timestamp(when),
                    "metric": obs["metric"],
                    "variantValues": {},
                }
                if obs.get("feature"):
                    group["feature"] = obs["feature"]
                observation_groups[group_key] = group
            group["variantValues"][obs["variant"]] = obs["value"]
        self._observations = []

        payload: Dict[str, Any] = {
            "appKey": self._app_key,
            "environment": self._environment,
            "time": to_protobuf_timestamp(),
            "stats": self._drain_map(self._measures),
            "counters": self._drain_map(self._counters),
            "observations": list(observation_groups.values()),
        }
        if self._instance_name:
            payload["instanceName"] = self._instance_name
        return payload


def metrics_options(
    feature: Optional[str] = None,
    variant: Optional[str] = None,
) -> MetricsFeatureOptions:
    """Convenience constructor for :class:`MetricsFeatureOptions`."""
    return MetricsFeatureOptions(feature=feature, variant=variant)


def options_from_mapping(
    options: Optional[Mapping[str, Any]],
) -> Optional[MetricsFeatureOptions]:
    """Accept dict-style options from public client APIs."""
    if options is None:
        return None
    return MetricsFeatureOptions(
        feature=options.get("feature"),
        variant=options.get("variant"),
    )
