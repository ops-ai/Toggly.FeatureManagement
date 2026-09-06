"""In-memory feature usage aggregator (Usage.SendStats payload shape)."""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from toggly.telemetry.grpc_clients import hash_identity, to_protobuf_timestamp


@dataclass
class VariantStatsAgg:
    """Per-variant counters for a feature."""

    check_count: int = 0
    request_count: int = 0
    used_count: int = 0
    viewed_count: int = 0

    def to_wire(self) -> dict[str, int]:
        """Serialize counters to the Usage wire shape."""
        return {
            "checkCount": self.check_count,
            "requestCount": self.request_count,
            "usedCount": self.used_count,
            "viewedCount": self.viewed_count,
        }


@dataclass
class FeatureUsageAgg:
    """Aggregated usage for one feature key."""

    variant_stats: dict[str, VariantStatsAgg] = field(default_factory=dict)
    unique_users_enabled: set[int] = field(default_factory=set)
    unique_users_disabled: set[int] = field(default_factory=set)
    unique_users_used: set[int] = field(default_factory=set)
    unique_users_viewed: set[int] = field(default_factory=set)
    unique_user_hashes: set[int] = field(default_factory=set)
    unique_viewed_user_hashes: set[int] = field(default_factory=set)


class UsageBatcher:
    """Accumulate feature usage and build FeatureStat payloads.

    Prefer ``variantStats`` over legacy scalars (matches .NET / Node).
    Thread-safe for concurrent record/flush.
    """

    def __init__(
        self,
        app_key: str,
        environment: str,
        *,
        instance_name: str | None = None,
        app_version: str | None = None,
        process_start_time: datetime | None = None,
    ) -> None:
        """Create an empty usage aggregator for one app/environment."""
        self._app_key = app_key
        self._environment = environment
        self._instance_name = instance_name
        self._app_version = app_version
        self._process_start_time = process_start_time or datetime.now(timezone.utc)
        self._per_feature: dict[str, FeatureUsageAgg] = {}
        self._app_unique: set[int] = set()
        self._lock = threading.RLock()

    def _get(self, feature: str) -> FeatureUsageAgg:
        agg = self._per_feature.get(feature)
        if agg is None:
            agg = FeatureUsageAgg()
            self._per_feature[feature] = agg
        return agg

    def _get_variant(self, agg: FeatureUsageAgg, variant: str) -> VariantStatsAgg:
        stats = agg.variant_stats.get(variant)
        if stats is None:
            stats = VariantStatsAgg()
            agg.variant_stats[variant] = stats
        return stats

    def _track_identity(self, identity: str | None, into: set[int]) -> None:
        if not identity:
            return
        hashed = hash_identity(identity)
        self._app_unique.add(hashed)
        into.add(hashed)

    def record_check(
        self,
        feature: str,
        enabled: bool,
        identity: str | None = None,
        variant: str | None = None,
        unique_request: bool = False,
    ) -> None:
        """Record a feature evaluation.

        ``checkCount`` increments on every call. ``requestCount`` only when
        ``unique_request`` is True (first access in a logical request).
        """
        with self._lock:
            agg = self._get(feature)
            name = variant if variant is not None else ("enabled" if enabled else "disabled")
            stats = self._get_variant(agg, name)
            stats.check_count += 1
            if unique_request:
                stats.request_count += 1

            if identity:
                hashed = hash_identity(identity)
                self._app_unique.add(hashed)
                if enabled:
                    agg.unique_users_enabled.add(hashed)
                else:
                    agg.unique_users_disabled.add(hashed)

    def record_usage(
        self,
        feature: str,
        identity: str | None = None,
        variant: str = "enabled",
    ) -> None:
        """Record a feature used/interaction event."""
        with self._lock:
            agg = self._get(feature)
            self._get_variant(agg, variant).used_count += 1
            self._track_identity(identity, agg.unique_users_used)
            if identity:
                agg.unique_user_hashes.add(hash_identity(identity))

    def record_view(
        self,
        feature: str,
        identity: str | None = None,
        variant: str = "enabled",
    ) -> None:
        """Record a feature viewed/rendered event."""
        with self._lock:
            agg = self._get(feature)
            self._get_variant(agg, variant).viewed_count += 1
            self._track_identity(identity, agg.unique_users_viewed)
            if identity:
                hashed = hash_identity(identity)
                self._app_unique.add(hashed)
                agg.unique_viewed_user_hashes.add(hashed)

    def is_empty(self) -> bool:
        """Return True when no usage samples are buffered."""
        with self._lock:
            return not self._per_feature and not self._app_unique

    def build_and_reset(self) -> dict[str, Any] | None:
        """Build a FeatureStat-shaped dict and clear aggregates."""
        with self._lock:
            if not self._per_feature and not self._app_unique:
                return None

            payload: dict[str, Any] = {
                "appKey": self._app_key,
                "environment": self._environment,
                "time": to_protobuf_timestamp(),
                "stats": [],
                "totalUniqueUsers": len(self._app_unique),
                "uniqueUserHashes": list(self._app_unique),
                "processStartTime": to_protobuf_timestamp(self._process_start_time),
            }
            if self._instance_name:
                payload["instanceName"] = self._instance_name
            if self._app_version:
                payload["appVersion"] = self._app_version

            stats_out: list[dict[str, Any]] = []
            for feature, agg in self._per_feature.items():
                variant_stats: dict[str, dict[str, int]] = {}
                for name, vs in agg.variant_stats.items():
                    if (
                        vs.check_count > 0
                        or vs.request_count > 0
                        or vs.used_count > 0
                        or vs.viewed_count > 0
                    ):
                        variant_stats[name] = vs.to_wire()
                stats_out.append(
                    {
                        "feature": feature,
                        "uniqueContextIdentifierEnabledCount": len(agg.unique_users_enabled),
                        "uniqueContextIdentifierDisabledCount": len(agg.unique_users_disabled),
                        "uniqueUsersUsedCount": len(agg.unique_users_used),
                        "uniqueUserHashes": list(agg.unique_user_hashes),
                        "uniqueViewedUserHashes": list(agg.unique_viewed_user_hashes),
                        "variantStats": variant_stats,
                    }
                )
            payload["stats"] = stats_out

            self._per_feature = {}
            self._app_unique = set()
            return payload
