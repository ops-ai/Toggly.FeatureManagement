package eval

import (
	"testing"
	"time"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/definitions"
)

func ctxFilter(prop, op, value, valueType string) definitions.FeatureFilter {
	return definitions.FeatureFilter{
		Name: "ContextProperty",
		Parameters: map[string]any{
			"Property": prop, "Operator": op, "Value": value, "ValueType": valueType,
		},
	}
}

func TestContextPropertyOperatorsAndGroups(t *testing.T) {
	eng := NewEngine(DefaultRegistry())
	def := definitions.FeatureDefinitionModel{
		FeatureKey:             "orders",
		RequirementType:        definitions.RequirementAny,
		ContextRequirementType: definitions.RequirementAll,
		Filters: []definitions.FeatureFilter{
			ctxFilter("Color", "eq", "red", "string"),
			ctxFilter("Age", "gte", "2", "number"),
			{Name: "AlwaysOn", Parameters: map[string]any{}},
		},
	}
	entity := &EntityContext{Kind: "Order", Key: "1", Attributes: map[string]any{"color": "red", "Age": 3}}
	on, err := eng.Evaluate(def, Context{Entity: entity})
	if err != nil || !on {
		t.Fatalf("expected enabled, err=%v on=%v", err, on)
	}
	on, _ = eng.Evaluate(def, Context{})
	if on {
		t.Fatal("no entity should fail closed")
	}
}

func TestContextPropertyFailClosedAndIn(t *testing.T) {
	eng := NewEngine(DefaultRegistry())
	missing := definitions.FeatureDefinitionModel{
		FeatureKey:      "f",
		RequirementType: definitions.RequirementAll,
		Filters:         []definitions.FeatureFilter{ctxFilter("Color", "neq", "red", "string")},
	}
	on, _ := eng.Evaluate(missing, Context{Entity: &EntityContext{Kind: "P", Key: "1", Attributes: map[string]any{}}})
	if on {
		t.Fatal("missing attr should fail closed")
	}
	inDef := definitions.FeatureDefinitionModel{
		FeatureKey:      "f",
		RequirementType: definitions.RequirementAll,
		Filters:         []definitions.FeatureFilter{ctxFilter("Color", "in", "red, blue", "string")},
	}
	on, _ = eng.Evaluate(inDef, Context{Entity: &EntityContext{Kind: "P", Key: "1", Attributes: map[string]any{"Color": "BLUE"}}})
	if !on {
		t.Fatal("in should match")
	}
	dt := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)
	dtDef := definitions.FeatureDefinitionModel{
		FeatureKey:      "f",
		RequirementType: definitions.RequirementAll,
		Filters:         []definitions.FeatureFilter{ctxFilter("Born", "gt", "2026-06-10T00:00:00Z", "datetime")},
	}
	on, _ = eng.Evaluate(dtDef, Context{Entity: &EntityContext{Kind: "O", Key: "1", Attributes: map[string]any{"Born": dt}}})
	if !on {
		t.Fatal("datetime gt should match")
	}
}
