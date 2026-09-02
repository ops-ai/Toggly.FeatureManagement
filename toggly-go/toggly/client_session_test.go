package toggly

import (
	"context"
	"testing"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/definitions"
)

func TestClient_PercentageStickyByFeatureKeyAndIdentity(t *testing.T) {
	c, err := NewClient(Config{
		AppKey:                   "app",
		Environment:              "env",
		BaseURL:                  "https://example.invalid/", // unused
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
		t.Fatalf("expected sticky result for same featureKey+identity, got %v then %v", a1, a2)
	}

	// Feature key seeds the hash: buckets differ across features for the same identity.
	b, err := c.IsEnabled(context.Background(), "flagB", ctx)
	if err != nil {
		t.Fatalf("IsEnabled flagB: %v", err)
	}
	if a1 == b {
		t.Fatalf("expected different Percentage outcomes across feature keys, got flagA=%v flagB=%v", a1, b)
	}
}

func TestClient_IsEnabled_ForwardsClaimsAndRequest(t *testing.T) {
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

	claimsOn, err := c.IsEnabled(context.Background(), "claims-flag", Context{
		Identity: "user-1",
		Claims:   map[string]string{"role": "admin"},
	})
	if err != nil {
		t.Fatalf("claims IsEnabled: %v", err)
	}
	if !claimsOn {
		t.Fatal("expected UserClaims match via forwarded Claims")
	}

	claimsOff, err := c.IsEnabled(context.Background(), "claims-flag", Context{
		Identity: "user-1",
		Claims:   map[string]string{"role": "user"},
	})
	if err != nil {
		t.Fatalf("claims miss IsEnabled: %v", err)
	}
	if claimsOff {
		t.Fatal("expected UserClaims mismatch to fail")
	}

	browserOn, err := c.IsEnabled(context.Background(), "browser-flag", Context{
		Identity: "user-1",
		Request: &RequestContext{
			UserAgent:      chromeUA,
			AcceptLanguage: "en-US",
			Country:        "US",
		},
	})
	if err != nil {
		t.Fatalf("browser IsEnabled: %v", err)
	}
	if !browserOn {
		t.Fatal("expected BrowserFamily match via forwarded Request")
	}

	browserOff, err := c.IsEnabled(context.Background(), "browser-flag", Context{
		Identity: "user-1",
		Request:  &RequestContext{UserAgent: "curl/8.0"},
	})
	if err != nil {
		t.Fatalf("browser miss IsEnabled: %v", err)
	}
	if browserOff {
		t.Fatal("expected BrowserFamily mismatch to fail")
	}
}
