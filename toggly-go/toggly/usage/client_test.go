package usage

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/autoflush"
	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/usage/usagepb"
)

type captureUsageClient struct {
	usagepb.UsageClient
	lastMD metadata.MD
	calls  int
}

func (c *captureUsageClient) SendStats(ctx context.Context, _ *usagepb.FeatureStat, _ ...grpc.CallOption) (*usagepb.StatResult, error) {
	c.calls++
	md, _ := metadata.FromOutgoingContext(ctx)
	c.lastMD = md
	return &usagepb.StatResult{FeatureCount: 1}, nil
}

type slowUsageClient struct {
	usagepb.UsageClient
	entered atomic.Int32
	release chan struct{}
}

func (c *slowUsageClient) SendStats(ctx context.Context, _ *usagepb.FeatureStat, _ ...grpc.CallOption) (*usagepb.StatResult, error) {
	c.entered.Add(1)
	select {
	case <-c.release:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	return &usagepb.StatResult{FeatureCount: 1}, nil
}

func TestClient_Flush_AttachesUAMetadata(t *testing.T) {
	api := &captureUsageClient{}
	c := &Client{
		api:       api,
		batcher:   NewBatcher("app", "Production", "", ""),
		userAgent: "toggly-go/0.6.0",
		flush:     autoflush.New(),
	}
	c.RecordCheck("F", true, "u1")
	if err := c.Flush(context.Background()); err != nil {
		t.Fatal(err)
	}
	if api.calls != 1 {
		t.Fatalf("calls = %d", api.calls)
	}
	vals := api.lastMD.Get("UA")
	if len(vals) != 1 || vals[0] != "toggly-go/0.6.0" {
		t.Fatalf("UA metadata = %v", vals)
	}
}

func TestClient_Close_WaitsForInFlightAutoFlush(t *testing.T) {
	conn, err := grpc.NewClient("localhost:1", grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatal(err)
	}
	api := &slowUsageClient{release: make(chan struct{})}
	c := &Client{
		conn:    conn,
		api:     api,
		batcher: NewBatcher("app", "Production", "", ""),
		flush:   autoflush.New(),
	}
	c.RecordCheck("F", true, "u1")
	c.StartAutoFlush(20 * time.Millisecond)

	deadline := time.Now().Add(2 * time.Second)
	for api.entered.Load() == 0 {
		if time.Now().After(deadline) {
			t.Fatal("auto-flush never entered SendStats")
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
