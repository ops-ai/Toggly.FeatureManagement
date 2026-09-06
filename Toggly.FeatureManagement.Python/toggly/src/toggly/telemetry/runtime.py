"""Telemetry runtime: batchers, flush timers, and process-exit handlers."""

from __future__ import annotations

import atexit
import contextlib
import logging
import os
import signal
import threading
from datetime import datetime, timezone
from typing import Any, Mapping

from toggly.telemetry.grpc_clients import (
    DEFAULT_METRICS_BASE_URL,
    DEFAULT_TELEMETRY_FLUSH_SECONDS,
    GrpcClients,
    MetricsGrpcClient,
    UsageGrpcClient,
    create_grpc_clients,
    is_grpc_available,
)
from toggly.telemetry.metrics_batcher import (
    MetricsBatcher,
    MetricsFeatureOptions,
    options_from_mapping,
)
from toggly.telemetry.usage_batcher import UsageBatcher

logger = logging.getLogger("toggly.telemetry")


class TelemetryRuntime:
    """Owns usage + metrics batchers, flush timers, and exit handlers."""

    SIGNAL_FLUSH_TIMEOUT_SECONDS = 2.0

    def __init__(
        self,
        *,
        app_key: str,
        environment: str,
        metrics_base_url: str | None = None,
        enable_usage_tracking: bool | None = None,
        enable_metrics: bool | None = None,
        usage_flush_interval: float | None = None,
        metrics_flush_interval: float | None = None,
        instance_name: str | None = None,
        app_version: str | None = None,
        usage_client: Any = None,
        metrics_client: Any = None,
        usage_client_provided: bool = False,
        metrics_client_provided: bool = False,
    ) -> None:
        """Create a telemetry runtime for one app/environment pair."""
        has_app_key = bool(app_key)
        telemetry_env_disabled = os.environ.get("TOGGLY_DISABLE_TELEMETRY") == "1"
        default_on = has_app_key and not telemetry_env_disabled

        self._app_key = app_key
        self._environment = environment
        self._metrics_base_url = (metrics_base_url or DEFAULT_METRICS_BASE_URL).rstrip(
            "/"
        ) + "/"
        self._enable_usage = (
            enable_usage_tracking if enable_usage_tracking is not None else default_on
        )
        self._enable_metrics = (
            enable_metrics if enable_metrics is not None else default_on
        )
        self._usage_flush_interval = (
            DEFAULT_TELEMETRY_FLUSH_SECONDS
            if usage_flush_interval is None
            else float(usage_flush_interval)
        )
        self._metrics_flush_interval = (
            DEFAULT_TELEMETRY_FLUSH_SECONDS
            if metrics_flush_interval is None
            else float(metrics_flush_interval)
        )
        self._instance_name = instance_name
        self._app_version = app_version
        self._injected_usage = usage_client
        self._injected_metrics = metrics_client
        self._usage_client_provided = usage_client_provided
        self._metrics_client_provided = metrics_client_provided

        self._usage_batcher: UsageBatcher | None = None
        self._metrics_batcher: MetricsBatcher | None = None
        self._clients: GrpcClients | None = None
        self._usage_timer: threading.Timer | None = None
        self._metrics_timer: threading.Timer | None = None
        self._sending_usage = False
        self._sending_metrics = False
        self._closed = False
        self._lock = threading.RLock()
        self._process_start_time = datetime.now(timezone.utc)
        self._signal_handlers: list[tuple[Any, Any]] = []
        self._atexit_registered = False

    @property
    def usage_enabled(self) -> bool:
        """True when usage tracking is active and the runtime is open."""
        return self._enable_usage and not self._closed

    @property
    def metrics_enabled(self) -> bool:
        """True when metrics tracking is active and the runtime is open."""
        return self._enable_metrics and not self._closed

    def start(self) -> None:
        """Create batchers, dial transport, and start flush timers."""
        if self._closed:
            return
        if not self._enable_usage and not self._enable_metrics:
            return

        needs_transport = self._enable_usage or self._enable_metrics
        if needs_transport:
            if self._usage_client_provided or self._metrics_client_provided:
                self._clients = GrpcClients(
                    usage=self._injected_usage,  # type: ignore[arg-type]
                    metrics=self._injected_metrics,  # type: ignore[arg-type]
                )
            elif not is_grpc_available():
                logger.warning(
                    "Usage/metrics enabled but grpcio/protobuf are not installed. "
                    "Install them to send telemetry: pip install toggly[telemetry]"
                )
            # Native gRPC clients are created lazily on first non-empty flush.

        if self._enable_usage:
            self._usage_batcher = UsageBatcher(
                self._app_key,
                self._environment,
                instance_name=self._instance_name,
                app_version=self._app_version,
                process_start_time=self._process_start_time,
            )
            if self._usage_flush_interval > 0:
                self._schedule_usage_flush()

        if self._enable_metrics:
            self._metrics_batcher = MetricsBatcher(
                self._app_key,
                self._environment,
                instance_name=self._instance_name,
            )
            if self._metrics_flush_interval > 0:
                self._schedule_metrics_flush()

        self._attach_exit_handlers()

    def _schedule_usage_flush(self) -> None:
        if self._closed or self._usage_flush_interval <= 0:
            return

        def _tick() -> None:
            try:
                self.flush_usage()
            finally:
                with self._lock:
                    if not self._closed and self._usage_flush_interval > 0:
                        self._schedule_usage_flush()

        timer = threading.Timer(self._usage_flush_interval, _tick)
        timer.daemon = True
        self._usage_timer = timer
        timer.start()

    def _schedule_metrics_flush(self) -> None:
        if self._closed or self._metrics_flush_interval <= 0:
            return

        def _tick() -> None:
            try:
                self.flush_metrics()
            finally:
                with self._lock:
                    if not self._closed and self._metrics_flush_interval > 0:
                        self._schedule_metrics_flush()

        timer = threading.Timer(self._metrics_flush_interval, _tick)
        timer.daemon = True
        self._metrics_timer = timer
        timer.start()

    def _attach_exit_handlers(self) -> None:
        if not self._atexit_registered:
            atexit.register(self._atexit_flush)
            self._atexit_registered = True

        for sig in (signal.SIGTERM, signal.SIGINT):
            try:
                previous = signal.getsignal(sig)

                def _handler(
                    signum: int,
                    frame: Any,
                    _sig: signal.Signals = sig,
                    _previous: Any = previous,
                ) -> None:
                    self._handle_process_signal(_sig)
                    if callable(_previous) and _previous not in (
                        signal.SIG_DFL,
                        signal.SIG_IGN,
                    ):
                        _previous(signum, frame)
                    else:
                        signal.signal(_sig, signal.SIG_DFL)
                        os.kill(os.getpid(), int(_sig))

                signal.signal(sig, _handler)
                self._signal_handlers.append((sig, previous))
            except (ValueError, OSError):
                # Not in main thread or signals unsupported
                pass

    def _atexit_flush(self) -> None:
        with contextlib.suppress(Exception):
            self.close()

    def _handle_process_signal(self, sig: signal.Signals) -> None:
        with contextlib.suppress(Exception):
            self.close()

    def _detach_exit_handlers(self) -> None:
        for sig, previous in self._signal_handlers:
            with contextlib.suppress(ValueError, OSError):
                signal.signal(sig, previous)
        self._signal_handlers.clear()

    def record_check(
        self,
        feature: str,
        enabled: bool,
        identity: str | None = None,
        variant: str | None = None,
        unique_request: bool = False,
    ) -> None:
        """Record a feature evaluation into the usage batcher."""
        with self._lock:
            batcher = self._usage_batcher
        if batcher is not None:
            batcher.record_check(
                feature, enabled, identity, variant, unique_request
            )

    def record_usage(
        self,
        feature: str,
        identity: str | None = None,
        variant: str = "enabled",
    ) -> None:
        """Record a feature used/interaction event."""
        with self._lock:
            batcher = self._usage_batcher
        if batcher is not None:
            batcher.record_usage(feature, identity, variant)

    def record_view(
        self,
        feature: str,
        identity: str | None = None,
        variant: str = "enabled",
    ) -> None:
        """Record a feature viewed/rendered event."""
        with self._lock:
            batcher = self._usage_batcher
        if batcher is not None:
            batcher.record_view(feature, identity, variant)

    def measure(
        self,
        metric: str,
        value: float,
        options: Mapping[str, Any] | MetricsFeatureOptions | None = None,
    ) -> None:
        """Aggregate a business measurement (sum over the flush window)."""
        with self._lock:
            batcher = self._metrics_batcher
        if batcher is None:
            return
        opts = (
            options
            if isinstance(options, MetricsFeatureOptions)
            else options_from_mapping(options)
        )
        batcher.measure(metric, value, opts)

    def increment_counter(
        self,
        metric: str,
        value: float = 1.0,
        options: Mapping[str, Any] | MetricsFeatureOptions | None = None,
    ) -> None:
        """Increment a business counter."""
        with self._lock:
            batcher = self._metrics_batcher
        if batcher is None:
            return
        opts = (
            options
            if isinstance(options, MetricsFeatureOptions)
            else options_from_mapping(options)
        )
        batcher.increment_counter(metric, value, opts)

    def observe(
        self,
        metric: str,
        value: float,
        options: Mapping[str, Any] | MetricsFeatureOptions | None = None,
    ) -> None:
        """Record a point-in-time observation (gauge)."""
        with self._lock:
            batcher = self._metrics_batcher
        if batcher is None:
            return
        opts = (
            options
            if isinstance(options, MetricsFeatureOptions)
            else options_from_mapping(options)
        )
        batcher.observe(metric, value, opts)

    def _ensure_native_clients(self) -> None:
        """Lazily dial native gRPC clients when optional deps are present."""
        if self._clients is not None:
            return
        if self._usage_client_provided or self._metrics_client_provided:
            return
        if not is_grpc_available():
            return
        self._clients = create_grpc_clients(self._metrics_base_url)
        if self._clients is None:
            logger.warning(
                "Failed to create Toggly gRPC clients; telemetry send disabled"
            )

    def flush_usage(self) -> None:
        """Flush usage batch if a send_stats client is available."""
        with self._lock:
            if self._usage_batcher is None or self._sending_usage:
                return
            if self._usage_batcher.is_empty():
                return
            self._ensure_native_clients()
            client: UsageGrpcClient | None = None
            if self._clients is not None:
                client = self._clients.usage
            if client is None or not hasattr(client, "send_stats"):
                logger.debug("Usage flush skipped: no gRPC client")
                return
            payload = self._usage_batcher.build_and_reset()
            if payload is None:
                return
            self._sending_usage = True

        try:
            client.send_stats(payload)
        except Exception as exc:
            logger.error("Failed to send usage stats: %s", exc)
        finally:
            with self._lock:
                self._sending_usage = False

    def flush_metrics(self) -> None:
        """Flush metrics batch if a send_metrics client is available."""
        with self._lock:
            if self._metrics_batcher is None or self._sending_metrics:
                return
            if self._metrics_batcher.is_empty():
                return
            self._ensure_native_clients()
            client: MetricsGrpcClient | None = None
            if self._clients is not None:
                client = self._clients.metrics
            if client is None or not hasattr(client, "send_metrics"):
                logger.debug("Metrics flush skipped: no gRPC client")
                return
            payload = self._metrics_batcher.build_and_reset()
            if payload is None:
                return
            self._sending_metrics = True

        try:
            client.send_metrics(payload)
        except Exception as exc:
            logger.error("Failed to send metrics: %s", exc)
        finally:
            with self._lock:
                self._sending_metrics = False

    def flush_all(self) -> None:
        """Flush usage and metrics batches once."""
        self.flush_usage()
        self.flush_metrics()

    def close(self) -> None:
        """Stop timers, flush once, and close gRPC clients."""
        with self._lock:
            if self._closed:
                return
            self._closed = True
            if self._usage_timer is not None:
                self._usage_timer.cancel()
                self._usage_timer = None
            if self._metrics_timer is not None:
                self._metrics_timer.cancel()
                self._metrics_timer = None

        self._detach_exit_handlers()

        try:
            self.flush_all()
        finally:
            clients = self._clients
            self._clients = None
            self._usage_batcher = None
            self._metrics_batcher = None
            if clients is not None:
                for side in (clients.usage, clients.metrics):
                    if side is None:
                        continue
                    with contextlib.suppress(Exception):
                        side.close()
