"""Optional gRPC transport helpers for usage and metrics telemetry."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Mapping, Optional, Protocol
from urllib.parse import urlparse

from toggly.version import __version__

logger = logging.getLogger("toggly.telemetry")

DEFAULT_METRICS_BASE_URL = "https://app.toggly.io/"
DEFAULT_TELEMETRY_FLUSH_SECONDS = 60.0

# HTTP/2 metadata is case-insensitive; .NET/Go/Node send ``UA``.
# grpcio requires lowercase ASCII keys, so the Python client uses ``ua``
# with the same user-agent semantics.
GRPC_USER_AGENT_METADATA_KEY = "ua"


def hash_identity(identity: str) -> int:
    """FNV-1a 32-bit as signed int32 (UTF-8 bytes; matches Go/Node)."""
    h = 2166136261
    for byte in identity.encode("utf-8"):
        h ^= byte
        h = (h * 16777619) & 0xFFFFFFFF
    return h - 0x100000000 if h > 0x7FFFFFFF else h


def to_protobuf_timestamp(dt: datetime | None = None) -> dict[str, int]:
    """Return ``{seconds, nanos}`` for a protobuf Timestamp."""
    if dt is None:
        dt = datetime.now(timezone.utc)
    elif dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    ms = int(dt.timestamp() * 1000)
    seconds = ms // 1000
    nanos = (ms % 1000) * 1_000_000
    return {"seconds": seconds, "nanos": nanos}


def grpc_target(base_url: str) -> str:
    """Derive ``host:port`` for a gRPC channel from a metrics base URL."""
    raw = base_url.strip()
    if "://" not in raw:
        raw = f"https://{raw}"
    try:
        parsed = urlparse(raw)
        host = parsed.netloc or parsed.path
    except Exception:
        host = raw.replace("https://", "").replace("http://", "").rstrip("/")
    host = host.rstrip("/")
    if not host:
        host = "app.toggly.io:443"
    if ":" not in host:
        host = f"{host}:443"
    return host


def resolve_user_agent(override: str | None = None) -> str:
    """Return gRPC user-agent metadata value (``ua`` key; matches .NET/Go UA)."""
    return override or f"toggly-python/{__version__}"


def is_grpc_available() -> bool:
    """Return True when optional grpcio + generated stubs can be imported."""
    try:
        import grpc  # noqa: F401
        from google.protobuf import timestamp_pb2  # noqa: F401

        from toggly.telemetry.pb import (  # noqa: F401  # noqa: F401
            metrics_pb2,
            metrics_pb2_grpc,
            usage_pb2,
            usage_pb2_grpc,
        )

        return True
    except Exception:
        return False


class UsageGrpcClient(Protocol):
    """Minimal usage transport used by :class:`TelemetryRuntime`."""

    def send_stats(
        self,
        request: Mapping[str, Any],
        metadata: Mapping[str, str] | None = None,
    ) -> Any:
        """Send a FeatureStat payload."""

    def close(self) -> None:
        """Close the underlying channel/stub."""


class MetricsGrpcClient(Protocol):
    """Minimal metrics transport used by :class:`TelemetryRuntime`."""

    def send_metrics(
        self,
        request: Mapping[str, Any],
        metadata: Mapping[str, str] | None = None,
    ) -> Any:
        """Send a MetricStat payload."""

    def close(self) -> None:
        """Close the underlying channel/stub."""


@dataclass
class GrpcClients:
    """Paired usage + metrics gRPC clients."""

    usage: UsageGrpcClient
    metrics: MetricsGrpcClient


def _timestamp_message(ts: Mapping[str, int]) -> Any:
    from google.protobuf.timestamp_pb2 import Timestamp

    msg = Timestamp()
    msg.seconds = int(ts.get("seconds", 0))
    msg.nanos = int(ts.get("nanos", 0))
    return msg


def feature_stat_from_payload(payload: Mapping[str, Any]) -> Any:
    """Convert a batcher dict payload into a Usage.FeatureStat message."""
    from toggly.telemetry.pb import usage_pb2

    # Generated pb2 modules are dynamically typed for mypy.
    msg = usage_pb2.FeatureStat()  # type: ignore[attr-defined]
    msg.appKey = str(payload.get("appKey", ""))
    msg.environment = str(payload.get("environment", ""))
    time_ts = payload.get("time")
    if isinstance(time_ts, Mapping):
        msg.time.CopyFrom(_timestamp_message(time_ts))
    msg.totalUniqueUsers = int(payload.get("totalUniqueUsers", 0))
    for h in payload.get("uniqueUserHashes") or []:
        msg.uniqueUserHashes.append(int(h))
    instance_name = payload.get("instanceName")
    if instance_name:
        msg.instanceName = str(instance_name)
    app_version = payload.get("appVersion")
    if app_version:
        msg.appVersion = str(app_version)
    process_start = payload.get("processStartTime")
    if isinstance(process_start, Mapping):
        msg.processStartTime.CopyFrom(_timestamp_message(process_start))

    for stat in payload.get("stats") or []:
        if not isinstance(stat, Mapping):
            continue
        sm = msg.stats.add()
        sm.feature = str(stat.get("feature", ""))
        sm.uniqueContextIdentifierEnabledCount = int(
            stat.get("uniqueContextIdentifierEnabledCount", 0)
        )
        sm.uniqueContextIdentifierDisabledCount = int(
            stat.get("uniqueContextIdentifierDisabledCount", 0)
        )
        sm.uniqueUsersUsedCount = int(stat.get("uniqueUsersUsedCount", 0))
        for h in stat.get("uniqueUserHashes") or []:
            sm.uniqueUserHashes.append(int(h))
        for h in stat.get("uniqueViewedUserHashes") or []:
            sm.uniqueViewedUserHashes.append(int(h))
        variant_stats = stat.get("variantStats") or {}
        if isinstance(variant_stats, Mapping):
            for name, vs in variant_stats.items():
                if not isinstance(vs, Mapping):
                    continue
                entry = usage_pb2.VariantStats(  # type: ignore[attr-defined]
                    checkCount=int(vs.get("checkCount", 0)),
                    requestCount=int(vs.get("requestCount", 0)),
                    usedCount=int(vs.get("usedCount", 0)),
                    viewedCount=int(vs.get("viewedCount", 0)),
                )
                sm.variantStats[str(name)].CopyFrom(entry)
    return msg


def metric_stat_from_payload(payload: Mapping[str, Any]) -> Any:
    """Convert a batcher dict payload into a Metrics.MetricStat message."""
    from toggly.telemetry.pb import metrics_pb2

    msg = metrics_pb2.MetricStat()  # type: ignore[attr-defined]
    msg.appKey = str(payload.get("appKey", ""))
    msg.environment = str(payload.get("environment", ""))
    time_ts = payload.get("time")
    if isinstance(time_ts, Mapping):
        msg.time.CopyFrom(_timestamp_message(time_ts))
    instance_name = payload.get("instanceName")
    if instance_name:
        msg.instanceName = str(instance_name)

    def _fill_variant_values(target: Any, variant_values: Mapping[str, Any]) -> None:
        for name, value in variant_values.items():
            target.variantValues[str(name)] = float(value)

    for item in payload.get("stats") or []:
        if not isinstance(item, Mapping):
            continue
        sm = msg.stats.add()
        sm.metric = str(item.get("metric", ""))
        feature = item.get("feature")
        if feature:
            sm.feature = str(feature)
        vv = item.get("variantValues") or {}
        if isinstance(vv, Mapping):
            _fill_variant_values(sm, vv)

    for item in payload.get("counters") or []:
        if not isinstance(item, Mapping):
            continue
        cm = msg.counters.add()
        cm.metric = str(item.get("metric", ""))
        feature = item.get("feature")
        if feature:
            cm.feature = str(feature)
        vv = item.get("variantValues") or {}
        if isinstance(vv, Mapping):
            _fill_variant_values(cm, vv)

    for item in payload.get("observations") or []:
        if not isinstance(item, Mapping):
            continue
        om = msg.observations.add()
        obs_time = item.get("time")
        if isinstance(obs_time, Mapping):
            om.time.CopyFrom(_timestamp_message(obs_time))
        om.metric = str(item.get("metric", ""))
        feature = item.get("feature")
        if feature:
            om.feature = str(feature)
        vv = item.get("variantValues") or {}
        if isinstance(vv, Mapping):
            _fill_variant_values(om, vv)
    return msg


class _SharedChannel:
    def __init__(self, channel: Any) -> None:
        self._channel = channel
        self._closed = False

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._channel.close()


class _NativeUsageClient:
    def __init__(
        self,
        stub: Any,
        shared: _SharedChannel,
        default_metadata: Mapping[str, str],
        timeout: float,
    ) -> None:
        self._stub = stub
        self._shared = shared
        self._default_metadata = dict(default_metadata)
        self._timeout = timeout

    def send_stats(
        self,
        request: Mapping[str, Any],
        metadata: Mapping[str, str] | None = None,
    ) -> Any:
        meta = {**self._default_metadata, **(metadata or {})}
        msg = feature_stat_from_payload(request)
        return self._stub.SendStats(
            msg,
            metadata=tuple(meta.items()),
            timeout=self._timeout,
        )

    def close(self) -> None:
        self._shared.close()


class _NativeMetricsClient:
    def __init__(
        self,
        stub: Any,
        shared: _SharedChannel,
        default_metadata: Mapping[str, str],
        timeout: float,
    ) -> None:
        self._stub = stub
        self._shared = shared
        self._default_metadata = dict(default_metadata)
        self._timeout = timeout

    def send_metrics(
        self,
        request: Mapping[str, Any],
        metadata: Mapping[str, str] | None = None,
    ) -> Any:
        meta = {**self._default_metadata, **(metadata or {})}
        msg = metric_stat_from_payload(request)
        return self._stub.SendMetrics(
            msg,
            metadata=tuple(meta.items()),
            timeout=self._timeout,
        )

    def close(self) -> None:
        self._shared.close()


def create_grpc_clients(
    metrics_base_url: str,
    user_agent: str | None = None,
    *,
    timeout: float = 10.0,
) -> GrpcClients | None:
    """Dial usage + metrics stubs. Returns ``None`` when gRPC deps are missing."""
    if not is_grpc_available():
        return None

    import grpc

    from toggly.telemetry.pb import metrics_pb2_grpc, usage_pb2_grpc

    target = grpc_target(metrics_base_url)
    channel = grpc.secure_channel(target, grpc.ssl_channel_credentials())
    shared = _SharedChannel(channel)
    ua = resolve_user_agent(user_agent)
    default_meta = {GRPC_USER_AGENT_METADATA_KEY: ua}

    usage_stub = usage_pb2_grpc.UsageStub(channel)
    metrics_stub = metrics_pb2_grpc.MetricsStub(channel)

    return GrpcClients(
        usage=_NativeUsageClient(usage_stub, shared, default_meta, timeout),
        metrics=_NativeMetricsClient(metrics_stub, shared, default_meta, timeout),
    )


# Typing helper for injectable factories in tests
GrpcClientFactory = Callable[[str, Optional[str]], Optional[GrpcClients]]
