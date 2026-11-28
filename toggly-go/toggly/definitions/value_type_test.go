package definitions

import "testing"

func TestValueTypeMatches(t *testing.T) {
	if !ValueType("").Matches(ValueTypeString) {
		t.Fatal("expected empty (legacy) declared type to allow any decode attempt")
	}
	if ValueTypeNumber.Matches(ValueTypeString) {
		t.Fatal("expected a declared mismatch to reject the decode attempt")
	}
	if !ValueTypeString.Matches(ValueTypeString) {
		t.Fatal("expected a matching declared type to allow the decode attempt")
	}
}

func TestResolvedValuePrefersValueThenConfigurationValue(t *testing.T) {
	withValue := FeatureDefinitionModel{Value: "primary", ConfigurationValue: "fallback"}
	if got := withValue.ResolvedValue(); got != "primary" {
		t.Fatalf("ResolvedValue = %#v; want primary", got)
	}

	fallbackOnly := FeatureDefinitionModel{ConfigurationValue: "fallback"}
	if got := fallbackOnly.ResolvedValue(); got != "fallback" {
		t.Fatalf("ResolvedValue = %#v; want fallback", got)
	}

	empty := FeatureDefinitionModel{}
	if got := empty.ResolvedValue(); got != nil {
		t.Fatalf("ResolvedValue = %#v; want nil", got)
	}
}
