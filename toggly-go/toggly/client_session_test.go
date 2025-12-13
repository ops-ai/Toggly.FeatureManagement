package toggly

import (
	"context"
	"testing"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/definitions"
)

func TestClient_PercentageDeterministicByIdentityOnly(t *testing.T) {
	c, err := NewClient(Config{
		AppKey:                  "app",
		Environment:             "env",
		BaseURL:                 "https://example.invalid/", // unused
		DisableBackgroundRefresh: true,
	})
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	defer func() { _ = c.Close() }()

	// Install two Percentage definitions with different feature keys.
	c.provider.applyDefinitions([]definitions.FeatureDefinitionModel{
		{
			FeatureKey: "flagA",
			Filters: []definitions.FeatureFilter{
				{Name: "Percentage", Parameters: map[string]any{"Value": 50}},
			},
			RequirementType: definitions.RequirementAny,
		},
		{
			FeatureKey: "flagB",
			Filters: []definitions.FeatureFilter{
				{Name: "Percentage", Parameters: map[string]any{"Value": 50}},
			},
			RequirementType: definitions.RequirementAny,
		},
	})

	ctx := Context{Identity: "user-1"}
	a1, err := c.IsEnabled(context.Background(), "flagA", ctx)
	if err != nil {
		t.Fatalf("IsEnabled 1: %v", err)
	}
	a2, err := c.IsEnabled(context.Background(), "flagA", ctx)
	if err != nil {
		t.Fatalf("IsEnabled 2: %v", err)
	}

	if a1 != a2 {
		t.Fatalf("expected deterministic result for same identity, got %v then %v", a1, a2)
	}

	// Identity-only: Percentage should be consistent across feature keys for the same identity.
	b, err := c.IsEnabled(context.Background(), "flagB", ctx)
	if err != nil {
		t.Fatalf("IsEnabled flagB: %v", err)
	}
	if a1 != b {
		t.Fatalf("expected identity-only consistency across feature keys, got flagA=%v flagB=%v", a1, b)
	}
}
