package eval

import (
	"errors"
	"testing"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/definitions"
)

type errorFilter struct{}

func (errorFilter) Evaluate(string, map[string]any, Context) (bool, error) {
	return false, errors.New("filter unavailable")
}

func TestEngineGroupEvaluationHandlesMissingAndFailingFilters(t *testing.T) {
	registry := DefaultRegistry()
	registry.Register("Error", errorFilter{})
	engine := NewEngine(registry)
	for _, tc := range []struct {
		name    string
		filters []definitions.FeatureFilter
		req     definitions.RequirementType
		want    bool
	}{
		{"any skips missing", []definitions.FeatureFilter{{Name: "Missing"}, {Name: "AlwaysOn"}}, definitions.RequirementAny, true},
		{"any skips error", []definitions.FeatureFilter{{Name: "Error"}, {Name: "AlwaysOn"}}, definitions.RequirementAny, true},
		{"all fails missing", []definitions.FeatureFilter{{Name: "AlwaysOn"}, {Name: "Missing"}}, definitions.RequirementAll, false},
		{"all fails error", []definitions.FeatureFilter{{Name: "AlwaysOn"}, {Name: "Error"}}, definitions.RequirementAll, false},
		{"all succeeds", []definitions.FeatureFilter{{Name: "AlwaysOn"}, {Name: "AlwaysOn"}}, definitions.RequirementAll, true},
		{"no filters", nil, definitions.RequirementAny, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := engine.Evaluate(definitions.FeatureDefinitionModel{FeatureKey: "checkout", Filters: tc.filters, RequirementType: tc.req}, Context{})
			if err != nil || got != tc.want {
				t.Fatalf("Evaluate() = %t, %v; want %t", got, err, tc.want)
			}
		})
	}
}
