package toggly

import (
	"context"
	"errors"
	"testing"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/usage"
)

func TestClient_Use_NilUsageStillRuns(t *testing.T) {
	c := &Client{}
	ran := false
	if err := c.Use(context.Background(), "Feat", Context{}, func(usage.FeatureUsageScope) error {
		ran = true
		return nil
	}); err != nil || !ran {
		t.Fatalf("err=%v ran=%v", err, ran)
	}
}

func TestClient_Use_PreCancelledCtxSkipsFn(t *testing.T) {
	c := &Client{}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	ran := false
	err := c.Use(ctx, "Feat", Context{}, func(usage.FeatureUsageScope) error {
		ran = true
		return nil
	})
	if !errors.Is(err, context.Canceled) || ran {
		t.Fatalf("err=%v ran=%v", err, ran)
	}
}

func TestClient_Use_WithBatcherRecordsAttempt(t *testing.T) {
	b := usage.NewBatcher("app", "Production", "", "")
	c := &Client{usage: usage.NewClientWithBatcher(b)}
	if err := c.Use(context.Background(), "Feat", Context{Identity: "u1"}, func(usage.FeatureUsageScope) error {
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := c.Use(ctx, "Feat", Context{Identity: "u1"}, func(usage.FeatureUsageScope) error {
		t.Fatal("fn must not run")
		return nil
	}); !errors.Is(err, context.Canceled) {
		t.Fatalf("got %v", err)
	}
}
