package toggly

import (
	"context"
	"errors"
	"testing"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/definitions"
	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/eval"
)

type failingFilter struct{}

func (failingFilter) Evaluate(string, map[string]any, eval.Context) (bool, error) {
	return false, errors.New("filter failed")
}

func TestEvaluateGateAnyAllNegatedAndErrors(t *testing.T) {
	client, err := NewClient(Config{AppKey: "app", DisableBackgroundRefresh: true, DisableEntityContextRegistration: true})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = client.Close() }()
	client.provider.applyDefinitions([]definitions.FeatureDefinitionModel{
		{FeatureKey: "on", Filters: []definitions.FeatureFilter{{Name: "AlwaysOn"}}},
		{FeatureKey: "off", Filters: []definitions.FeatureFilter{{Name: "AlwaysOff"}}},
		{FeatureKey: "error", Filters: []definitions.FeatureFilter{{Name: "Fails"}}, RequirementType: definitions.RequirementAny},
	})
	client.RegisterFilter("Fails", failingFilter{})

	for _, tc := range []struct {
		name   string
		keys   []string
		req    Requirement
		negate bool
		want   bool
	}{
		{"empty", nil, RequirementAny, false, false},
		{"any", []string{"off", "on"}, RequirementAny, false, true},
		{"all", []string{"off", "on"}, RequirementAll, false, false},
		{"all on", []string{"on"}, RequirementAll, false, true},
		{"negated any", []string{"off"}, RequirementAny, true, true},
		{"negated all", []string{"off", "on"}, RequirementAll, true, false},
		{"unknown requirement defaults to any", []string{"on"}, "unknown", false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := client.EvaluateGate(context.Background(), tc.keys, tc.req, Context{}, tc.negate)
			if err != nil || got != tc.want {
				t.Fatalf("EvaluateGate() = %t, %v; want %t", got, err, tc.want)
			}
		})
	}
	for _, req := range []Requirement{RequirementAny, RequirementAll} {
		if got, err := client.EvaluateGate(context.Background(), []string{"error"}, req, Context{}, false); err != nil || got {
			t.Fatalf("%s gate with failing filter = %t, %v; want false, nil", req, got, err)
		}
	}
}
