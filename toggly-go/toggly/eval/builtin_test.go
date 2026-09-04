package eval

import (
	"testing"
	"time"
)

func TestTargetingEvaluator_UserAndGroup(t *testing.T) {
	e := TargetingEvaluator{}

	params := map[string]any{
		"Audience.Users:0":                  "alice",
		"Audience.Groups:0":                 "beta",
		"Audience.DefaultRolloutPercentage": float64(0),
	}

	on, err := e.Evaluate("f", params, Context{Identity: "alice"})
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if !on {
		t.Fatalf("expected alice to be targeted")
	}

	on, err = e.Evaluate("f", params, Context{Identity: "bob", Groups: []string{"beta"}})
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if !on {
		t.Fatalf("expected beta group to be targeted")
	}
}

func TestTargetingEvaluator_ExclusionUserWins(t *testing.T) {
	e := TargetingEvaluator{}
	params := map[string]any{
		"Audience.Users:0":                  "alice",
		"Audience.Exclusion.Users:0":        "alice",
		"Audience.DefaultRolloutPercentage": float64(100),
	}

	on, err := e.Evaluate("f", params, Context{Identity: "alice"})
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if on {
		t.Fatalf("expected excluded alice to be off")
	}

	on, err = e.Evaluate("f", params, Context{Identity: "bob"})
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if !on {
		t.Fatalf("expected bob to pass default rollout")
	}
}

func TestTargetingEvaluator_ExclusionGroupWins(t *testing.T) {
	e := TargetingEvaluator{}
	params := map[string]any{
		"Audience.Exclusion.Groups:0":       "banned",
		"Audience.DefaultRolloutPercentage": float64(100),
	}

	on, err := e.Evaluate("f", params, Context{Identity: "u", Groups: []string{"banned"}})
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if on {
		t.Fatalf("expected banned group to be excluded")
	}
}

func TestTargetingEvaluator_MicrosoftAliasAndColonKeys(t *testing.T) {
	e := TargetingEvaluator{}
	params := map[string]any{
		"Audience:Users:0":                  "alice",
		"Audience.DefaultRolloutPercentage": float64(0),
	}

	on, err := e.Evaluate("f", params, Context{Identity: "alice"})
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if !on {
		t.Fatalf("expected colon-form inclusion for alice")
	}

	reg := DefaultRegistry()
	ev, ok := reg.get("Microsoft.Targeting")
	if !ok {
		t.Fatalf("expected Microsoft.Targeting registration")
	}
	on, err = ev.Evaluate("f", params, Context{Identity: "alice"})
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if !on {
		t.Fatalf("expected Microsoft.Targeting alias to evaluate")
	}

	excl := map[string]any{
		"Audience:Exclusion:Users:0":        "alice",
		"Audience.DefaultRolloutPercentage": float64(100),
	}
	on, err = e.Evaluate("f", excl, Context{Identity: "alice"})
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if on {
		t.Fatalf("expected colon-form exclusion for alice")
	}
}

func TestTargetingEvaluator_DefaultRolloutDeterministic(t *testing.T) {
	e := TargetingEvaluator{}
	featureKey := "f"
	identity := "user"

	bucket := ComputePercentile(identity, featureKey)
	params := map[string]any{
		"Audience.DefaultRolloutPercentage": bucket + 0.01,
	}

	on, err := e.Evaluate(featureKey, params, Context{Identity: identity})
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if !on {
		t.Fatalf("expected enabled when pct just above bucket")
	}

	params["Audience.DefaultRolloutPercentage"] = bucket - 0.01
	off, err := e.Evaluate(featureKey, params, Context{Identity: identity})
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if off {
		t.Fatalf("expected disabled when pct just below bucket")
	}
}

func TestTimeWindowEvaluator(t *testing.T) {
	now := time.Date(2025, 1, 2, 3, 4, 5, 0, time.UTC)
	e := TimeWindowEvaluator{Now: func() time.Time { return now }}

	params := map[string]any{
		"Start": now.Add(-time.Minute).Format(time.RFC3339Nano),
		"End":   now.Add(time.Minute).Format(time.RFC3339Nano),
	}

	on, err := e.Evaluate("f", params, Context{})
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if !on {
		t.Fatalf("expected in-window to be enabled")
	}
}

func TestTimeWindowEvaluator_OpenEnded(t *testing.T) {
	now := time.Date(2025, 1, 2, 3, 4, 5, 0, time.UTC)
	e := TimeWindowEvaluator{Now: func() time.Time { return now }}
	ctx := Context{}

	must := func(params map[string]any, want bool, label string) {
		t.Helper()
		on, err := e.Evaluate("f", params, ctx)
		if err != nil {
			t.Fatalf("%s: err: %v", label, err)
		}
		if on != want {
			t.Fatalf("%s: got %v want %v", label, on, want)
		}
	}

	must(map[string]any{"Start": "2020-01-01T00:00:00Z"}, true, "start-only past")
	must(map[string]any{"Start": "2030-01-01T00:00:00Z"}, false, "start-only future")
	must(map[string]any{"End": "2030-01-01T00:00:00Z"}, true, "end-only future")
	must(map[string]any{"End": "2020-01-01T00:00:00Z"}, false, "end-only past")
	must(map[string]any{}, true, "neither bound")
	must(map[string]any{"Start": "not-a-date", "End": "also-bad"}, false, "invalid both")
	must(map[string]any{"Start": "not-a-date"}, false, "invalid start-only")
	must(map[string]any{"End": "also-bad"}, false, "invalid end-only")
}

func TestPercentageEvaluator_StickyFeatureKey(t *testing.T) {
	e := PercentageEvaluator{}
	params := map[string]any{"Value": float64(50)}
	ctx := Context{Identity: "user-123"}

	// demo-feature bucket ~60.1 → false at 50
	a, err := e.Evaluate("demo-feature", params, ctx)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if a {
		t.Fatalf("expected demo-feature disabled at 50%%")
	}

	b, err := e.Evaluate("demo-feature", map[string]any{"Value": float64(61)}, ctx)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if !b {
		t.Fatalf("expected demo-feature enabled at 61%%")
	}

	// Feature key changes the bucket
	c, err := e.Evaluate("other-flag", params, ctx)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	_ = c
	if ComputePercentile("user-123", "demo-feature") == ComputePercentile("user-123", "other-flag") {
		t.Fatalf("expected different buckets across features")
	}
}

func TestAlwaysOnAlwaysOffEvaluators(t *testing.T) {
	on := AlwaysOnEvaluator{}
	off := AlwaysOffEvaluator{}
	ctx := Context{Identity: "u"}

	v, err := on.Evaluate("f", nil, ctx)
	if err != nil || !v {
		t.Fatalf("AlwaysOn: got %v err %v", v, err)
	}
	v, err = off.Evaluate("f", nil, ctx)
	if err != nil || v {
		t.Fatalf("AlwaysOff: got %v err %v", v, err)
	}
}
