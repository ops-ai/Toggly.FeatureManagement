package metrics

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/autoflush"
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

type slowMetricsClient struct {
	metricspb.MetricsClient
	entered atomic.Int32
	release chan struct{}
}

func (c *slowMetricsClient) SendMetrics(ctx context.Context, _ *metricspb.MetricStat, _ ...grpc.CallOption) (*metricspb.MetricResult, error) {
	c.entered.Add(1)
	select {
	case <-c.release:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	return &metricspb.MetricResult{Count: 1}, nil
}

func TestClient_Flush_AttachesUAMetadata(t *testing.T) {
	api := &captureMetricsClient{}
	c := &Client{
		api:       api,
		batcher:   NewBatcher("app", "Production", ""),
		userAgent: "toggly-go/0.5.0",
		flush:     autoflush.New(),
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

func TestClient_Close_WaitsForInFlightAutoFlush(t *testing.T) {
	conn, err := grpc.NewClient("localhost:1", grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatal(err)
	}
	api := &slowMetricsClient{release: make(chan struct{})}
	c := &Client{
		conn:    conn,
		api:     api,
		batcher: NewBatcher("app", "Production", ""),
		flush:   autoflush.New(),
	}
	c.Measure("m", 1, nil, "")
	c.StartAutoFlush(20 * time.Millisecond)

	deadline := time.Now().Add(2 * time.Second)
	for api.entered.Load() == 0 {
		if time.Now().After(deadline) {
			t.Fatal("auto-flush never entered SendMetrics")
		}
		time.Sleep(5 * time.Millisecond)
	}

	done := make(chan struct{})
	go func() {
		_ = c.Close()
		close(done)
	}()

	select {
	case <-done:
		t.Fatal("Close returned before in-flight auto-flush finished")
	case <-time.After(50 * time.Millisecond):
	}

	close(api.release)
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Close did not return after auto-flush released")
	}
}
