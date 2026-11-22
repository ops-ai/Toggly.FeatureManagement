package toggly

import (
	"encoding/json"
	"testing"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/eval"
)

func TestContextJSONRejectsNumericIdentity(t *testing.T) {
	var ctx Context
	err := json.Unmarshal([]byte(`{"Identity":42}`), &ctx)
	if err == nil {
		t.Fatal("Identity is a string; a JSON number must be rejected without panic")
	}
}

func TestNullGroupSlotDoesNotPanicAndRealGroupStillMatches(t *testing.T) {
	var ctx Context
	if err := json.Unmarshal([]byte(`{"Groups":[null,"beta"]}`), &ctx); err != nil {
		t.Fatalf("null group slot: %v", err)
	}
	if len(ctx.Groups) != 2 || ctx.Groups[0] != "" || ctx.Groups[1] != "beta" {
		t.Fatalf("JSON null string became %#v", ctx.Groups)
	}

	named := map[string]any{
		"Audience.Groups:0":                 "beta",
		"Audience.DefaultRolloutPercentage": float64(0),
	}
	on, err := eval.TargetingEvaluator{}.Evaluate("flag", named, eval.Context{Groups: ctx.Groups})
	if err != nil {
		t.Fatal(err)
	}
	if !on {
		t.Fatal("real group beside a null slot should match")
	}

	onlyNull := map[string]any{
		"Audience.Groups:0":                 "beta",
		"Audience.DefaultRolloutPercentage": float64(0),
	}
	on, err = eval.TargetingEvaluator{}.Evaluate("flag", onlyNull, eval.Context{Groups: []string{""}})
	if err != nil {
		t.Fatal(err)
	}
	if on {
		t.Fatal("null slot alone should not match")
	}

	rollout := map[string]any{
		"Audience.Groups:0":                 "beta",
		"Audience.DefaultRolloutPercentage": float64(100),
	}
	on, err = eval.TargetingEvaluator{}.Evaluate("flag", rollout, eval.Context{Groups: []string{""}})
	if err != nil {
		t.Fatal(err)
	}
	if !on {
		t.Fatal("null slot alone must not exclude a 100% rollout")
	}
}

func TestEmptyIdentityNamedAudienceReturnsFalse(t *testing.T) {
	named := map[string]any{
		"Audience.Users:0":                  "alice",
		"Audience.DefaultRolloutPercentage": float64(0),
	}
	on, err := eval.TargetingEvaluator{}.Evaluate("flag", named, eval.Context{})
	if err != nil {
		t.Fatal(err)
	}
	if on {
		t.Fatal("empty identity must not match a named audience")
	}

	empty := map[string]any{"Audience.DefaultRolloutPercentage": float64(0)}
	on, err = eval.TargetingEvaluator{}.Evaluate("flag", empty, eval.Context{})
	if err != nil {
		t.Fatal(err)
	}
	if on {
		t.Fatal("empty audience must stay off")
	}
}
