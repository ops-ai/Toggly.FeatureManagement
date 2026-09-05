package metrics

import (
	"context"
	"testing"

	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/metrics/metricspb"
)

type captureMetricsClient struct {
	metricspb.MetricsClient
	lastMD metadata.MD
	calls  int
}

func (c *captureMetricsClient) SendMetrics(ctx context.Context, _ *metricspb.MetricStat, _ ...grpc.CallOption) (*metricspb.MetricResult, error) {
	c.calls++
	md, _ := metadata.FromOutgoingContext(ctx)
	c.lastMD = md
	return &metricspb.MetricResult{Count: 1}, nil
}

func TestClient_Flush_AttachesUAMetadata(t *testing.T) {
	api := &captureMetricsClient{}
	c := &Client{
		api:       api,
		batcher:   NewBatcher("app", "Production", ""),
		userAgent: "toggly-go/0.5.0",
		stop:      make(chan struct{}),
	}
	c.Measure("m", 1, nil, "")
	if err := c.Flush(context.Background()); err != nil {
		t.Fatal(err)
	}
	if api.calls != 1 {
		t.Fatalf("calls = %d", api.calls)
	}
	vals := api.lastMD.Get("UA")
	if len(vals) != 1 || vals[0] != "toggly-go/0.5.0" {
		t.Fatalf("UA metadata = %v", vals)
	}
}
