package usage

import (
	"context"
	"testing"

	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"

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

func TestClient_Flush_AttachesUAMetadata(t *testing.T) {
	api := &captureUsageClient{}
	c := &Client{
		api:       api,
		batcher:   NewBatcher("app", "Production", "", ""),
		userAgent: "toggly-go/0.5.0",
		stop:      make(chan struct{}),
	}
	c.RecordCheck("F", true, "u1")
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
