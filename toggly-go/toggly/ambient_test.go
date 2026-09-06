package toggly

import (
	"context"
	"testing"
)

func TestMergeContext_OverrideWins(t *testing.T) {
	ambient := Context{
		Identity: "ambient",
		Groups:   []string{"a"},
		Claims:   map[string]string{"role": "user"},
		Request:  &RequestContext{UserAgent: "UA-A", Country: "US"},
		Traits:   map[string]any{"k": "v"},
	}
	perCall := Context{
		Identity: "override",
		Claims:   map[string]string{"role": "admin"},
	}

	got := MergeContext(ambient, perCall)
	if got.Identity != "override" {
		t.Fatalf("identity: got %q", got.Identity)
	}
	if len(got.Groups) != 1 || got.Groups[0] != "a" {
		t.Fatalf("groups should stay ambient: %#v", got.Groups)
	}
	if got.Claims["role"] != "admin" {
		t.Fatalf("claims should override: %#v", got.Claims)
	}
	if got.Request == nil || got.Request.UserAgent != "UA-A" || got.Request.Country != "US" {
		t.Fatalf("request should stay ambient: %#v", got.Request)
	}
	if got.Traits["k"] != "v" {
		t.Fatalf("traits should stay ambient: %#v", got.Traits)
	}
}

func TestMergeContext_NilPerCallKeepsAmbient(t *testing.T) {
	ambient := Context{
		Identity: "ambient",
		Groups:   []string{"g"},
		Request:  &RequestContext{Country: "DE"},
	}
	got := MergeContext(ambient, Context{})
	if got.Identity != "ambient" || len(got.Groups) != 1 || got.Request == nil || got.Request.Country != "DE" {
		t.Fatalf("empty per-call should keep ambient: %#v", got)
	}
}

func TestMergeContext_EmptySliceOverrides(t *testing.T) {
	ambient := Context{Groups: []string{"a"}}
	got := MergeContext(ambient, Context{Groups: []string{}})
	if got.Groups == nil {
		t.Fatalf("empty non-nil groups should override ambient")
	}
	if len(got.Groups) != 0 {
		t.Fatalf("expected empty groups, got %#v", got.Groups)
	}
}

func TestResolveEvalContext_PullsAmbient(t *testing.T) {
	ambient := Context{
		Identity: "alice",
		Request:  &RequestContext{UserAgent: "Mozilla/5.0", Country: "FR"},
	}
	ctx := WithEvalContext(context.Background(), ambient)

	got := ResolveEvalContext(ctx, Context{})
	if got.Identity != "alice" {
		t.Fatalf("expected ambient identity, got %q", got.Identity)
	}
	if got.Request == nil || got.Request.Country != "FR" {
		t.Fatalf("expected ambient request, got %#v", got.Request)
	}

	got = ResolveEvalContext(ctx, Context{Identity: "bob"})
	if got.Identity != "bob" {
		t.Fatalf("override identity: got %q", got.Identity)
	}
	if got.Request == nil || got.Request.Country != "FR" {
		t.Fatalf("request should remain ambient: %#v", got.Request)
	}
}

func TestResolveEvalContext_NoAmbient(t *testing.T) {
	per := Context{Identity: "solo"}
	got := ResolveEvalContext(context.Background(), per)
	if got.Identity != "solo" {
		t.Fatalf("got %#v", got)
	}
}

func TestWithEvalContext_RoundTrip(t *testing.T) {
	ctx := WithEvalContext(context.Background(), Context{Identity: "u1"})
	got, ok := EvalContextFrom(ctx)
	if !ok || got.Identity != "u1" {
		t.Fatalf("round-trip failed: ok=%v got=%#v", ok, got)
	}
}
