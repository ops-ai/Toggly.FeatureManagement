package eval

import (
	"testing"
	"time"
)

func TestTargetingEvaluator_UserAndGroup(t *testing.T) {
	e := TargetingEvaluator{}

	params := map[string]any{
		"Audience.Users:0":                "alice",
		"Audience.Groups:0":               "beta",
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

func TestTargetingEvaluator_DefaultRolloutDeterministic(t *testing.T) {
	e := TargetingEvaluator{}
	featureKey := "f"
	identity := "user"

	bucket := rolloutBucket(featureKey, identity)
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

func TestPercentageEvaluator_DeterministicIdentityOnly(t *testing.T) {
	e := PercentageEvaluator{}

	params := map[string]any{"Value": float64(50)}
	ctx := Context{Identity: "user-123"}

	a, err := e.Evaluate("featureA", params, ctx)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	b, err := e.Evaluate("featureA", params, ctx)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if a != b {
		t.Fatalf("expected deterministic result for same identity, got %v then %v", a, b)
	}

	c, err := e.Evaluate("featureB", params, ctx)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if a != c {
		t.Fatalf("expected identity-only consistency across feature keys, got %v vs %v", a, c)
	}
}
