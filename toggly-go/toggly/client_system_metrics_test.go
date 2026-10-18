package toggly

import (
	"context"
	"testing"
	"time"

	"google.golang.org/grpc"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/metrics"
	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/metrics/metricspb"
	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/metrics/systemmetrics"
)

type captureSendMetricsAPI struct {
	metricspb.MetricsClient
	last *metricspb.MetricStat
}

func (c *captureSendMetricsAPI) SendMetrics(_ context.Context, stat *metricspb.MetricStat, _ ...grpc.CallOption) (*metricspb.MetricResult, error) {
	c.last = stat
	return &metricspb.MetricResult{Count: 1}, nil
}

func metricsClientForSystemMetricsTest(t *testing.T, api metricspb.MetricsClient) *metrics.Client {
	t.Helper()
	mc, err := metrics.NewClientForTest(api, "app", "Production", "instance")
	if err != nil {
		t.Fatal(err)
	}
	return mc
}

func TestNewClientOmitsSystemMetricsWhenDisabled(t *testing.T) {
	api := &captureSendMetricsAPI{}
	client, err := NewClient(Config{
		AppKey: "app", EnableMetrics: true, MetricsClient: metricsClientForSystemMetricsTest(t, api),
		DisableBackgroundRefresh: true, DisableEntityContextRegistration: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = client.Close() }()
	if client.systemMetrics != nil {
		t.Fatal("expected no system metrics collector when SystemMetrics is false")
	}
}

func TestNewClientConfiguresSystemMetrics(t *testing.T) {
	api := &captureSendMetricsAPI{}
	sampler := func() []systemmetrics.Observation {
		return []systemmetrics.Observation{
			{Metric: "CpuUsage", Value: 3.25},
			{Metric: "GoroutineCount", Value: 12},
		}
	}
	client, err := NewClient(Config{
		AppKey: "app", EnableMetrics: true, MetricsClient: metricsClientForSystemMetricsTest(t, api),
		SystemMetrics: true, SystemMetricsInterval: time.Hour, SystemMetricsSampler: sampler,
		DisableBackgroundRefresh: true, DisableEntityContextRegistration: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if client.systemMetrics == nil {
		t.Fatal("expected system metrics collector")
	}
	client.systemMetrics.Tick()
	if err := client.MetricsClient().Flush(context.Background()); err != nil {
		t.Fatal(err)
	}
	if api.last == nil || len(api.last.Observations) < 2 {
		t.Fatalf("expected flushed observations, got %+v", api.last)
	}
	if err := client.Close(); err != nil {
		t.Fatal(err)
	}
	if client.systemMetrics != nil {
		t.Fatal("Close should clear system metrics collector")
	}
}

func TestNewClientSystemMetricsWithoutOptionOverrides(t *testing.T) {
	api := &captureSendMetricsAPI{}
	client, err := NewClient(Config{
		AppKey: "app", EnableMetrics: true, MetricsClient: metricsClientForSystemMetricsTest(t, api),
		SystemMetrics:            true,
		DisableBackgroundRefresh: true, DisableEntityContextRegistration: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = client.Close() }()
	if client.systemMetrics == nil {
		t.Fatal("expected system metrics collector with default options")
	}
	client.systemMetrics.Tick()
}

func TestSystemMetricsRequiresEnableMetrics(t *testing.T) {
	client, err := NewClient(Config{
		AppKey: "app", SystemMetrics: true,
		DisableBackgroundRefresh: true, DisableEntityContextRegistration: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = client.Close() }()
	if client.systemMetrics != nil {
		t.Fatal("SystemMetrics without EnableMetrics must not start a collector")
	}
}
