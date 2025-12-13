package togglyctx

import (
	"context"
	"testing"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly"
)

func TestWithFrom(t *testing.T) {
	ctx := context.Background()
	if _, ok := From(ctx); ok {
		t.Fatalf("expected empty")
	}

	e := toggly.Context{Identity: "u1"}
	ctx = With(ctx, e)
	got, ok := From(ctx)
	if !ok {
		t.Fatalf("expected ok")
	}
	if got.Identity != "u1" {
		t.Fatalf("expected identity u1, got %q", got.Identity)
	}
}
