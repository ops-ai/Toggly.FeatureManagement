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

    def clone(self) -> VariantStatsAgg:
        """Return a shallow copy of these counters."""
        return VariantStatsAgg(
            check_count=self.check_count,
            request_count=self.request_count,
            used_count=self.used_count,
            viewed_count=self.viewed_count,
        )


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

    def clone(self) -> FeatureUsageAgg:
        """Deep-copy aggregates for failed-send restore snapshots."""
        return FeatureUsageAgg(
            variant_stats={name: vs.clone() for name, vs in self.variant_stats.items()},
            unique_users_enabled=set(self.unique_users_enabled),
            unique_users_disabled=set(self.unique_users_disabled),
            unique_users_used=set(self.unique_users_used),
            unique_users_viewed=set(self.unique_users_viewed),
            unique_user_hashes=set(self.unique_user_hashes),
            unique_viewed_user_hashes=set(self.unique_viewed_user_hashes),
        )


@dataclass
class UsageBatchSnapshot:
    """Full in-memory batch captured at drain for failed-send restore."""

    per_feature: dict[str, FeatureUsageAgg]
    app_unique: set[int]
    definition_cache_hits: int
    definition_cache_misses: int


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
        self._definition_cache_hits = 0
        self._definition_cache_misses = 0
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

    def record_definition_cache_hit(self) -> None:
        """Count a definition-refresh outcome served from local/cache."""
        with self._lock:
            self._definition_cache_hits += 1

    def record_definition_cache_miss(self) -> None:
        """Count a definition-refresh that applied a new network revision."""
        with self._lock:
            self._definition_cache_misses += 1

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
        """Return True when no usage or cache-hit samples are buffered."""
        with self._lock:
            return (
                not self._per_feature
                and not self._app_unique
                and self._definition_cache_hits == 0
                and self._definition_cache_misses == 0
            )

    def _clone_snapshot(self) -> UsageBatchSnapshot:
        return UsageBatchSnapshot(
            per_feature={
                feature: agg.clone() for feature, agg in self._per_feature.items()
            },
            app_unique=set(self._app_unique),
            definition_cache_hits=self._definition_cache_hits,
            definition_cache_misses=self._definition_cache_misses,
        )

    def _build_payload_unlocked(self) -> dict[str, Any]:
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
        if self._definition_cache_hits > 0:
            payload["definitionCacheHits"] = self._definition_cache_hits
        if self._definition_cache_misses > 0:
            payload["definitionCacheMisses"] = self._definition_cache_misses

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
        return payload

    def _clear_unlocked(self) -> None:
        self._per_feature = {}
        self._app_unique = set()
        self._definition_cache_hits = 0
        self._definition_cache_misses = 0

    def export_and_reset(
        self,
    ) -> tuple[dict[str, Any], UsageBatchSnapshot] | None:
        """Build the SendStats payload, clear pending state, and return a restore snapshot."""
        with self._lock:
            if (
                not self._per_feature
                and not self._app_unique
                and self._definition_cache_hits == 0
                and self._definition_cache_misses == 0
            ):
                return None
            snapshot = self._clone_snapshot()
            payload = self._build_payload_unlocked()
            self._clear_unlocked()
            return payload, snapshot

    def build_and_reset(self) -> dict[str, Any] | None:
        """Build a FeatureStat-shaped dict and clear aggregates."""
        drained = self.export_and_reset()
        return None if drained is None else drained[0]

    def restore(self, snapshot: UsageBatchSnapshot) -> None:
        """Merge a drained snapshot after send_stats failure (additive)."""
        with self._lock:
            self._definition_cache_hits += snapshot.definition_cache_hits
            self._definition_cache_misses += snapshot.definition_cache_misses
            self._app_unique.update(snapshot.app_unique)

            for feature, snap_agg in snapshot.per_feature.items():
                agg = self._get(feature)
                for name, snap_stats in snap_agg.variant_stats.items():
                    stats = self._get_variant(agg, name)
                    stats.check_count += snap_stats.check_count
                    stats.request_count += snap_stats.request_count
                    stats.used_count += snap_stats.used_count
                    stats.viewed_count += snap_stats.viewed_count
                agg.unique_users_enabled.update(snap_agg.unique_users_enabled)
                agg.unique_users_disabled.update(snap_agg.unique_users_disabled)
                agg.unique_users_used.update(snap_agg.unique_users_used)
                agg.unique_users_viewed.update(snap_agg.unique_users_viewed)
                agg.unique_user_hashes.update(snap_agg.unique_user_hashes)
                agg.unique_viewed_user_hashes.update(snap_agg.unique_viewed_user_hashes)
