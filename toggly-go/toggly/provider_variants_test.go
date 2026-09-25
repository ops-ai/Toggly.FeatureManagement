package toggly

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

const catalogVariantsDefsJSON = `[
  {
    "featureKey": "checkout-flow",
    "filters": [{"name": "AlwaysOn", "parameters": {}}],
    "metrics": [],
    "securedFeature": false,
    "clientSdkEnabled": true,
    "requirementType": "Any",
    "variants": [
      {"name": "A", "configurationValue": {"color": "blue"}, "statusOverride": "None"},
      {"name": "B", "configurationValue": {"color": "green"}, "statusOverride": "None"}
    ],
    "allocation": {
      "defaultWhenEnabled": "B",
      "defaultWhenDisabled": null,
      "seed": null,
      "user": [{"variant": "A", "users": ["alice", "bob"]}],
      "group": null,
      "percentile": null
    }
  },
  {
    "featureKey": "kill-switch",
    "filters": [],
    "metrics": [],
    "securedFeature": false,
    "clientSdkEnabled": true,
    "requirementType": "Any",
    "variants": [
      {"name": "Off", "configurationValue": {"killSwitch": true}, "statusOverride": "Enabled"}
    ],
    "allocation": {
      "defaultWhenEnabled": null,
      "defaultWhenDisabled": "Off",
      "seed": null,
      "user": null,
      "group": null,
      "percentile": null
    }
  },
  {
    "featureKey": "no-variants-feature",
    "filters": [{"name": "AlwaysOn", "parameters": {}}],
    "metrics": [],
    "securedFeature": false,
    "clientSdkEnabled": true,
    "requirementType": "Any",
    "variants": [],
    "allocation": null
  }
]`

func newCatalogVariantsClient(t *testing.T) *Client {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("ETag", `"v1"`)
		_, _ = w.Write([]byte(catalogVariantsDefsJSON))
	}))
	t.Cleanup(srv.Close)

	c, err := NewClient(Config{
		AppKey:                   "app",
		Environment:              "env",
		DefinitionsURL:           srv.URL + "/",
		HTTPTimeout:              2 * time.Second,
		RefreshInterval:          time.Hour,
		DisableBackgroundRefresh: true,
	})
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	t.Cleanup(func() { _ = c.Close() })

	if err := c.provider.refresh(context.Background(), time.Second, false); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	return c
}

func TestClient_GetVariant_UserAllocation(t *testing.T) {
	c := newCatalogVariantsClient(t)

	v, err := c.GetVariant(context.Background(), "checkout-flow", Context{Identity: "alice"})
	if err != nil {
		t.Fatalf("GetVariant: %v", err)
	}
	if v == nil || v.Name != "A" || !v.Enabled {
		t.Fatalf("unexpected variant: %#v", v)
	}
	if m, ok := v.ConfigurationValue.(map[string]any); !ok || m["color"] != "blue" {
		t.Fatalf("unexpected configuration value: %#v", v.ConfigurationValue)
	}
}

func TestClient_GetVariant_FallsBackToDefaultWhenEnabled(t *testing.T) {
	c := newCatalogVariantsClient(t)

	v, err := c.GetVariant(context.Background(), "checkout-flow", Context{Identity: "carol"})
	if err != nil {
		t.Fatalf("GetVariant: %v", err)
	}
	if v == nil || v.Name != "B" || !v.Enabled {
		t.Fatalf("unexpected variant: %#v", v)
	}
}

func TestClient_GetVariant_StatusOverrideFlipsDisabledFeature(t *testing.T) {
	c := newCatalogVariantsClient(t)

	v, err := c.GetVariant(context.Background(), "kill-switch", Context{Identity: "anyone"})
	if err != nil {
		t.Fatalf("GetVariant: %v", err)
	}
	// kill-switch has no enabled filters (base disabled), but StatusOverride:
	// Enabled on the DefaultWhenDisabled variant flips the effective enabled state.
	if v == nil || v.Name != "Off" || !v.Enabled {
		t.Fatalf("unexpected variant: %#v", v)
	}
}

func TestClient_GetVariant_NoVariantsConfigured_ReturnsNil(t *testing.T) {
	c := newCatalogVariantsClient(t)

	v, err := c.GetVariant(context.Background(), "no-variants-feature", Context{Identity: "alice"})
	if err != nil {
		t.Fatalf("GetVariant: %v", err)
	}
	if v != nil {
		t.Fatalf("expected nil variant, got %#v", v)
	}
}

func TestClient_GetVariant_UnknownFeature_ReturnsNil(t *testing.T) {
	c := newCatalogVariantsClient(t)

	v, err := c.GetVariant(context.Background(), "does-not-exist", Context{Identity: "alice"})
	if err != nil {
		t.Fatalf("GetVariant: %v", err)
	}
	if v != nil {
		t.Fatalf("expected nil variant, got %#v", v)
	}
}

func TestClient_GetVariant_RequiresFeatureKey(t *testing.T) {
	c := newCatalogVariantsClient(t)

	if _, err := c.GetVariant(context.Background(), "", Context{}); err == nil {
		t.Fatal("expected error for empty featureKey")
	}
}

func TestClient_GetVariant_UsesAmbientContext(t *testing.T) {
	c := newCatalogVariantsClient(t)

	ctx := WithEvalContext(context.Background(), Context{Identity: "bob"})
	v, err := c.GetVariant(ctx, "checkout-flow", Context{})
	if err != nil {
		t.Fatalf("GetVariant: %v", err)
	}
	if v == nil || v.Name != "A" {
		t.Fatalf("expected ambient identity to resolve variant A, got %#v", v)
	}
}

func TestClient_GetVariantValue(t *testing.T) {
	c := newCatalogVariantsClient(t)

	value, err := c.GetVariantValue(context.Background(), "checkout-flow", Context{Identity: "alice"})
	if err != nil {
		t.Fatalf("GetVariantValue: %v", err)
	}
	m, ok := value.(map[string]any)
	if !ok || m["color"] != "blue" {
		t.Fatalf("unexpected configuration value: %#v", value)
	}

	value, err = c.GetVariantValue(context.Background(), "does-not-exist", Context{})
	if err != nil || value != nil {
		t.Fatalf("expected nil value/no error, got value=%#v err=%v", value, err)
	}
}

type checkoutConfig struct {
	Color string `json:"color"`
}

func TestGetVariantValueAs_Object(t *testing.T) {
	c := newCatalogVariantsClient(t)

	cfg, ok := GetVariantValueAs[checkoutConfig](c, context.Background(), "checkout-flow", Context{Identity: "alice"})
	if !ok {
		t.Fatal("expected typed bind to succeed")
	}
	if cfg.Color != "blue" {
		t.Fatalf("expected color=blue, got %#v", cfg)
	}
}

func TestGetVariantValueAs_Mismatch(t *testing.T) {
	c := newCatalogVariantsClient(t)

	_, ok := GetVariantValueAs[string](c, context.Background(), "checkout-flow", Context{Identity: "alice"})
	if ok {
		t.Fatal("expected mismatch to soft-fail")
	}
}

func TestGetVariantValueAs_Missing(t *testing.T) {
	c := newCatalogVariantsClient(t)

	_, ok := GetVariantValueAs[checkoutConfig](c, context.Background(), "does-not-exist", Context{})
	if ok {
		t.Fatal("expected missing assignment to soft-fail")
	}
}

func TestGetVariantValueAs_Scalar(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("ETag", `"v1"`)
		_, _ = w.Write([]byte(`[
		  {
		    "featureKey": "banner",
		    "filters": [{"name": "AlwaysOn", "parameters": {}}],
		    "variants": [{"name": "A", "configurationValue": "hello"}],
		    "allocation": {"defaultWhenEnabled": "A"}
		  }
		]`))
	}))
	t.Cleanup(srv.Close)

	c, err := NewClient(Config{
		AppKey:                   "app",
		Environment:              "env",
		DefinitionsURL:           srv.URL + "/",
		HTTPTimeout:              2 * time.Second,
		RefreshInterval:          time.Hour,
		DisableBackgroundRefresh: true,
	})
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	t.Cleanup(func() { _ = c.Close() })
	if err := c.provider.refresh(context.Background(), time.Second, false); err != nil {
		t.Fatalf("refresh: %v", err)
	}

	got, ok := GetVariantValueAs[string](c, context.Background(), "banner", Context{})
	if !ok || got != "hello" {
		t.Fatalf("expected hello, got %q ok=%v", got, ok)
	}
}
