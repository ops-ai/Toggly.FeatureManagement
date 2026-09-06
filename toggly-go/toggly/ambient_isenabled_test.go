package toggly

import (
	"context"
	"testing"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/definitions"
)

func TestClient_IsEnabled_MergesAmbientContext(t *testing.T) {
	c, err := NewClient(Config{
		AppKey:                   "app",
		Environment:              "env",
		BaseURL:                  "https://example.invalid/",
		DisableBackgroundRefresh: true,
	})
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	defer func() { _ = c.Close() }()

	const chromeUA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

	c.provider.applyDefinitions([]definitions.FeatureDefinitionModel{
		{
			FeatureKey: "claims-flag",
			Filters: []definitions.FeatureFilter{
				{
					Name: "UserClaims",
					Parameters: map[string]any{
						"Percentage": float64(100),
						"Claim":      "role",
						"Value":      "admin",
					},
				},
			},
			RequirementType: definitions.RequirementAny,
		},
		{
			FeatureKey: "browser-flag",
			Filters: []definitions.FeatureFilter{
				{
					Name: "BrowserFamily",
					Parameters: map[string]any{
						"Percentage":      float64(100),
						"BrowserFamily:0": "Chrome",
					},
				},
			},
			RequirementType: definitions.RequirementAny,
		},
	})

	ambient := Context{
		Identity: "ambient-user",
		Claims:   map[string]string{"role": "admin"},
		Request:  &RequestContext{UserAgent: chromeUA},
	}
	ctx := WithEvalContext(context.Background(), ambient)

	// Empty per-call pulls ambient claims + request
	claimsOn, err := c.IsEnabled(ctx, "claims-flag", Context{})
	if err != nil {
		t.Fatalf("ambient claims: %v", err)
	}
	if !claimsOn {
		t.Fatal("expected ambient claims to enable UserClaims filter")
	}

	browserOn, err := c.IsEnabled(ctx, "browser-flag", Context{})
	if err != nil {
		t.Fatalf("ambient request: %v", err)
	}
	if !browserOn {
		t.Fatal("expected ambient request UA to enable BrowserFamily")
	}

	// Per-call claims override wins (wrong role → off)
	claimsOff, err := c.IsEnabled(ctx, "claims-flag", Context{
		Claims: map[string]string{"role": "user"},
	})
	if err != nil {
		t.Fatalf("override claims: %v", err)
	}
	if claimsOff {
		t.Fatal("expected per-call claims override to disable")
	}
}
