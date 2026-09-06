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

func TestResolve_OverrideWins(t *testing.T) {
	ctx := With(context.Background(), toggly.Context{
		Identity: "ambient",
		Claims:   map[string]string{"role": "user"},
		Request:  &toggly.RequestContext{Country: "US"},
	})

	got := Resolve(ctx, toggly.Context{Identity: "override"})
	if got.Identity != "override" {
		t.Fatalf("identity: %q", got.Identity)
	}
	if got.Claims["role"] != "user" {
		t.Fatalf("claims should stay ambient: %#v", got.Claims)
	}
	if got.Request == nil || got.Request.Country != "US" {
		t.Fatalf("request should stay ambient: %#v", got.Request)
	}
}

func TestMerge_FieldByField(t *testing.T) {
	got := Merge(
		toggly.Context{Identity: "a", Groups: []string{"g"}},
		toggly.Context{Groups: []string{"x", "y"}},
	)
	if got.Identity != "a" {
		t.Fatalf("identity: %q", got.Identity)
	}
	if len(got.Groups) != 2 || got.Groups[0] != "x" {
		t.Fatalf("groups: %#v", got.Groups)
	}
}
