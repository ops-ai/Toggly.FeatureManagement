"""Native protobuf + gRPC metadata path tests (not injected fakes)."""

from __future__ import annotations

from typing import Any, List, Optional, Tuple

import grpc
import pytest

from toggly.telemetry.grpc_clients import (
    GRPC_USER_AGENT_METADATA_KEY,
    _NativeMetricsClient,
    _NativeUsageClient,
    _SharedChannel,
    create_grpc_clients,
    feature_stat_from_payload,
    is_grpc_available,
    metric_stat_from_payload,
    resolve_user_agent,
)
from toggly.version import __version__


class RecordingUsageStub:
    def __init__(self) -> None:
        self.calls: List[dict] = []

    def SendStats(
        self,
        request: Any,
        metadata: Optional[Tuple[Tuple[str, str], ...]] = None,
        timeout: Optional[float] = None,
    ) -> dict:
        self.calls.append(
            {"request": request, "metadata": metadata, "timeout": timeout}
        )
        return {"featureCount": 1}


class RecordingMetricsStub:
    def __init__(self) -> None:
        self.calls: List[dict] = []

    def SendMetrics(
        self,
        request: Any,
        metadata: Optional[Tuple[Tuple[str, str], ...]] = None,
        timeout: Optional[float] = None,
    ) -> dict:
        self.calls.append(
            {"request": request, "metadata": metadata, "timeout": timeout}
        )
        return {"count": 1}


def _invoke_with_metadata(metadata: Tuple[Tuple[str, str], ...]) -> None:
    """Call a dummy unary RPC so grpcio validates metadata keys."""
    channel = grpc.insecure_channel("localhost:1")
    try:
        method = channel.unary_unary(
            "/test.Service/Method",
            request_serializer=lambda x: x,
            response_deserializer=lambda x: x,
        )
        method(b"", metadata=metadata, timeout=0.01, wait_for_ready=False)
    finally:
        channel.close()


def _assert_grpcio_accepts_metadata(metadata: Tuple[Tuple[str, str], ...]) -> None:
    """Fail if grpcio would reject metadata before the RPC leaves the client."""
    try:
        _invoke_with_metadata(metadata)
    except ValueError as exc:
        pytest.fail(f"grpcio rejected metadata {metadata!r}: {exc}")
    except grpc.RpcError:
        # Connection failure is expected; metadata already passed validation.
        pass


class TestNativeGrpcPath:
    def test_grpc_stubs_importable_with_declared_floor(self) -> None:
        assert is_grpc_available() is True
        import sys

        import grpc as grpc_mod

        from toggly.telemetry.pb import metrics_pb2_grpc, usage_pb2_grpc

        parts = [int(p) for p in grpc_mod.__version__.split(".")[:3]]
        # Stubs declare a floor that Python 3.8 can install; Python ≥3.9
        # installs grpcio≥1.80 from the telemetry extra.
        if sys.version_info >= (3, 9):
            assert parts >= [1, 80, 0]
        else:
            assert parts >= [1, 62, 0]
        assert usage_pb2_grpc.GRPC_GENERATED_VERSION == "1.62.0"
        assert metrics_pb2_grpc.GRPC_GENERATED_VERSION == "1.62.0"

    def test_feature_stat_native_protobuf_serialization(self) -> None:
        payload = {
            "appKey": "app",
            "environment": "Production",
            "time": {"seconds": 1_700_000_000, "nanos": 0},
            "totalUniqueUsers": 1,
            "uniqueUserHashes": [42],
            "instanceName": "worker-1",
            "appVersion": "1.2.3",
            "stats": [
                {
                    "feature": "FeatureA",
                    "uniqueContextIdentifierEnabledCount": 1,
                    "uniqueContextIdentifierDisabledCount": 0,
                    "uniqueUsersUsedCount": 1,
                    "uniqueUserHashes": [42],
                    "uniqueViewedUserHashes": [],
                    "variantStats": {
                        "enabled": {
                            "checkCount": 2,
                            "requestCount": 1,
                            "usedCount": 1,
                            "viewedCount": 0,
                        }
                    },
                }
            ],
        }
        msg = feature_stat_from_payload(payload)
        raw = msg.SerializeToString()
        assert isinstance(raw, bytes) and len(raw) > 0
        assert msg.appKey == "app"
        assert msg.stats[0].feature == "FeatureA"
        assert msg.stats[0].variantStats["enabled"].checkCount == 2

    def test_metric_stat_native_protobuf_serialization(self) -> None:
        payload = {
            "appKey": "app",
            "environment": "Production",
            "time": {"seconds": 1_700_000_000, "nanos": 0},
            "stats": [
                {
                    "metric": "revenue",
                    "feature": "FeatureA",
                    "variantValues": {"enabled": 9.5},
                }
            ],
            "counters": [{"metric": "clicks", "variantValues": {"enabled": 3.0}}],
            "observations": [
                {
                    "time": {"seconds": 1_700_000_001, "nanos": 0},
                    "metric": "depth",
                    "variantValues": {"enabled": 2.0},
                }
            ],
        }
        msg = metric_stat_from_payload(payload)
        raw = msg.SerializeToString()
        assert isinstance(raw, bytes) and len(raw) > 0
        assert msg.stats[0].metric == "revenue"
        assert msg.stats[0].variantValues["enabled"] == pytest.approx(9.5)
        assert msg.counters[0].metric == "clicks"
        assert msg.observations[0].metric == "depth"

    def test_native_usage_client_attaches_ua_metadata(self) -> None:
        stub = RecordingUsageStub()
        shared = _SharedChannel(type("Ch", (), {"close": lambda self: None})())
        ua = resolve_user_agent()
        client = _NativeUsageClient(
            stub,
            shared,
            {GRPC_USER_AGENT_METADATA_KEY: ua},
            timeout=5.0,
        )
        payload = {
            "appKey": "app",
            "environment": "Production",
            "time": {"seconds": 1, "nanos": 0},
            "stats": [
                {
                    "feature": "FeatureA",
                    "variantStats": {
                        "enabled": {
                            "checkCount": 1,
                            "requestCount": 0,
                            "usedCount": 0,
                            "viewedCount": 0,
                        }
                    },
                }
            ],
        }
        client.send_stats(payload)

        assert len(stub.calls) == 1
        meta = stub.calls[0]["metadata"]
        assert meta is not None
        assert dict(meta)[GRPC_USER_AGENT_METADATA_KEY] == ua
        assert GRPC_USER_AGENT_METADATA_KEY == "ua"
        assert ua == f"toggly-python/{__version__}"
        _assert_grpcio_accepts_metadata(meta)
        assert stub.calls[0]["request"].SerializeToString()
        assert stub.calls[0]["request"].stats[0].feature == "FeatureA"

    def test_native_metrics_client_attaches_ua_metadata(self) -> None:
        stub = RecordingMetricsStub()
        shared = _SharedChannel(type("Ch", (), {"close": lambda self: None})())
        ua = "custom-ua/1.0"
        client = _NativeMetricsClient(
            stub,
            shared,
            {GRPC_USER_AGENT_METADATA_KEY: ua},
            timeout=5.0,
        )
        payload = {
            "appKey": "app",
            "environment": "Production",
            "time": {"seconds": 1, "nanos": 0},
            "stats": [{"metric": "revenue", "variantValues": {"enabled": 1.0}}],
            "counters": [],
            "observations": [],
        }
        client.send_metrics(payload)

        assert len(stub.calls) == 1
        meta = stub.calls[0]["metadata"]
        assert meta is not None
        assert dict(meta) == {"ua": ua}
        _assert_grpcio_accepts_metadata(meta)
        assert stub.calls[0]["request"].SerializeToString()

    def test_uppercase_ua_rejected_by_grpcio_regression(self) -> None:
        # grpcio may raise ValueError (client validate) or RpcError INTERNAL
        # "Invalid metadata" depending on version/platform.
        with pytest.raises((ValueError, grpc.RpcError)) as exc_info:
            _invoke_with_metadata((("UA", resolve_user_agent()),))
        err = str(exc_info.value).lower()
        assert "metadata" in err or "illegal header" in err or "invalid" in err

    def test_create_grpc_clients_default_metadata_key(self, monkeypatch: pytest.MonkeyPatch) -> None:
        captured: dict = {}

        class FakeChannel:
            def close(self) -> None:
                pass

        class FakeUsageStub:
            def __init__(self, channel: Any) -> None:
                captured["usage_channel"] = channel

        class FakeMetricsStub:
            def __init__(self, channel: Any) -> None:
                captured["metrics_channel"] = channel

        monkeypatch.setattr(
            "toggly.telemetry.grpc_clients.is_grpc_available",
            lambda: True,
        )
        monkeypatch.setattr(
            "toggly.telemetry.pb.usage_pb2_grpc.UsageStub", FakeUsageStub
        )
        monkeypatch.setattr(
            "toggly.telemetry.pb.metrics_pb2_grpc.MetricsStub", FakeMetricsStub
        )
        monkeypatch.setattr(
            grpc,
            "secure_channel",
            lambda *args, **kwargs: FakeChannel(),
        )
        monkeypatch.setattr(
            grpc,
            "ssl_channel_credentials",
            lambda *args, **kwargs: object(),
        )

        clients = create_grpc_clients("https://app.toggly.io/", "agent/9")
        assert clients is not None
        assert clients.usage._default_metadata == {"ua": "agent/9"}  # type: ignore[attr-defined]
        assert clients.metrics._default_metadata == {"ua": "agent/9"}  # type: ignore[attr-defined]
        clients.usage.close()
