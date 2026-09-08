package usage

import (
	"context"
	"errors"
	"testing"

	"google.golang.org/grpc"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/autoflush"
	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/usage/usagepb"
)

type failThenSucceedUsageClient struct {
	usagepb.UsageClient
	failFirst bool
	calls     int
	lastMsg   *usagepb.FeatureStat
}

func (c *failThenSucceedUsageClient) SendStats(_ context.Context, msg *usagepb.FeatureStat, _ ...grpc.CallOption) (*usagepb.StatResult, error) {
	c.calls++
	c.lastMsg = msg
	if c.failFirst {
		c.failFirst = false
		return nil, errors.New("send failed")
	}
	return &usagepb.StatResult{FeatureCount: 1}, nil
}

func TestClient_Flush_CacheOnlySends(t *testing.T) {
	api := &failThenSucceedUsageClient{}
	c := &Client{
		api:     api,
		batcher: NewBatcher("app", "Production", "", ""),
		flush:   autoflush.New(),
	}
	c.RecordDefinitionCacheHit()
	if err := c.Flush(context.Background()); err != nil {
		t.Fatal(err)
	}
	if api.calls != 1 {
		t.Fatalf("calls = %d, want 1", api.calls)
	}
	if api.lastMsg.GetDefinitionCacheHits() != 1 {
		t.Fatalf("hits = %d", api.lastMsg.GetDefinitionCacheHits())
	}
}

func TestClient_Flush_RestoresOnFailureThenSucceeds(t *testing.T) {
	api := &failThenSucceedUsageClient{failFirst: true}
	c := &Client{
		api:     api,
		batcher: NewBatcher("app", "Production", "", ""),
		flush:   autoflush.New(),
	}
	c.RecordCheck("Feat", true, "u1")
	c.RecordDefinitionCacheHit()

	if err := c.Flush(context.Background()); err == nil {
		t.Fatal("expected first flush to fail")
	}
	if api.calls != 1 {
		t.Fatalf("calls after fail = %d", api.calls)
	}

	// In-flight record while first send failed
	c.RecordDefinitionCacheMiss()

	if err := c.Flush(context.Background()); err != nil {
		t.Fatal(err)
	}
	if api.calls != 2 {
		t.Fatalf("calls = %d, want 2", api.calls)
	}
	if api.lastMsg.GetDefinitionCacheHits() != 1 {
		t.Fatalf("restored hits = %d", api.lastMsg.GetDefinitionCacheHits())
	}
	if api.lastMsg.GetDefinitionCacheMisses() != 1 {
		t.Fatalf("merged misses = %d", api.lastMsg.GetDefinitionCacheMisses())
	}
	if len(api.lastMsg.Stats) != 1 {
		t.Fatalf("restored feature stats = %d", len(api.lastMsg.Stats))
	}
}
