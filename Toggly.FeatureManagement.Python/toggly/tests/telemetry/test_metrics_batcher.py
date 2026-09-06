"""Tests for metrics batcher payload shape."""

from toggly.telemetry import MetricsBatcher, MetricsFeatureOptions


class TestMetricsBatcher:
    def test_aggregates_measure_increment_observe_into_variant_values(self) -> None:
        batcher = MetricsBatcher("app", "Production", instance_name="host-1")

        batcher.measure("revenue", 10)
        batcher.measure(
            "revenue", 5, MetricsFeatureOptions(feature="Checkout", variant="enabled")
        )
        batcher.measure(
            "revenue", 2, MetricsFeatureOptions(feature="Checkout", variant="disabled")
        )
        batcher.increment_counter("clicks", 3)
        batcher.increment_counter(
            "clicks", 1, MetricsFeatureOptions(feature="Banner")
        )
        batcher.observe("latency_ms", 12.5)
        batcher.observe(
            "latency_ms",
            8,
            MetricsFeatureOptions(feature="Checkout", variant="control"),
        )

        payload = batcher.build_and_reset()
        assert payload is not None
        assert payload["appKey"] == "app"
        assert payload["instanceName"] == "host-1"

        global_revenue = next(
            s for s in payload["stats"] if s["metric"] == "revenue" and "feature" not in s
        )
        assert global_revenue["variantValues"]["enabled"] == 10

        checkout_revenue = next(
            s
            for s in payload["stats"]
            if s["metric"] == "revenue" and s.get("feature") == "Checkout"
        )
        assert checkout_revenue["variantValues"]["enabled"] == 5
        assert checkout_revenue["variantValues"]["disabled"] == 2

        clicks = next(
            c
            for c in payload["counters"]
            if c["metric"] == "clicks" and "feature" not in c
        )
        assert clicks["variantValues"]["enabled"] == 3

        banner_clicks = next(
            c
            for c in payload["counters"]
            if c["metric"] == "clicks" and c.get("feature") == "Banner"
        )
        assert banner_clicks["variantValues"]["enabled"] == 1

        assert len(payload["observations"]) >= 2
        global_obs = next(
            o
            for o in payload["observations"]
            if o["metric"] == "latency_ms" and "feature" not in o
        )
        assert global_obs["variantValues"]["enabled"] == 12.5
        checkout_obs = next(
            o
            for o in payload["observations"]
            if o["metric"] == "latency_ms" and o.get("feature") == "Checkout"
        )
        assert checkout_obs["variantValues"]["control"] == 8

        assert batcher.build_and_reset() is None
