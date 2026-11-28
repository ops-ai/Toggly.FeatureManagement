package toggly

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// Catalog fixture for the typed flag value getters (OPS-2102):
// GetStringValue / GetNumberValue / GetJSONValue / GetDateTimeValue.
const catalogFeatureValueDefsJSON = `[
  {
    "featureKey": "greeting",
    "filters": [{"name": "AlwaysOn", "parameters": {}}],
    "requirementType": "Any",
    "valueType": "string",
    "value": "hello"
  },
  {
    "featureKey": "limit",
    "filters": [{"name": "AlwaysOn", "parameters": {}}],
    "requirementType": "Any",
    "valueType": "number",
    "value": 42
  },
  {
    "featureKey": "config",
    "filters": [{"name": "AlwaysOn", "parameters": {}}],
    "requirementType": "Any",
    "valueType": "json",
    "value": {"nested": {"flag": true}}
  },
  {
    "featureKey": "launch-at",
    "filters": [{"name": "AlwaysOn", "parameters": {}}],
    "requirementType": "Any",
    "valueType": "datetime",
    "value": "2026-06-01T00:00:00Z"
  },
  {
    "featureKey": "disabled-greeting",
    "filters": [],
    "requirementType": "Any",
    "valueType": "string",
    "value": "hello"
  },
  {
    "featureKey": "legacy-greeting",
    "filters": [{"name": "AlwaysOn", "parameters": {}}],
    "requirementType": "Any",
    "value": "hello"
  }
]`

func newCatalogFeatureValueClient(t *testing.T) *Client {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("ETag", `"v1"`)
		_, _ = w.Write([]byte(catalogFeatureValueDefsJSON))
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

func TestClient_GetStringValue_MatchesDeclaredType(t *testing.T) {
	c := newCatalogFeatureValueClient(t)

	got, ok := c.GetStringValue(context.Background(), "greeting", Context{})
	if !ok || got != "hello" {
		t.Fatalf("GetStringValue = %q, %v; want hello, true", got, ok)
	}
}

func TestClient_GetStringValue_SoftNullsOnDeclaredMismatch(t *testing.T) {
	c := newCatalogFeatureValueClient(t)

	if _, ok := c.GetStringValue(context.Background(), "limit", Context{}); ok {
		t.Fatal("expected GetStringValue to soft-null on a number-declared flag")
	}
}

func TestClient_GetNumberValue(t *testing.T) {
	c := newCatalogFeatureValueClient(t)

	got, ok := c.GetNumberValue(context.Background(), "limit", Context{})
	if !ok || got != 42 {
		t.Fatalf("GetNumberValue = %v, %v; want 42, true", got, ok)
	}
}

func TestClient_GetJSONValue(t *testing.T) {
	c := newCatalogFeatureValueClient(t)

	got, ok := c.GetJSONValue(context.Background(), "config", Context{})
	if !ok {
		t.Fatal("expected GetJSONValue to decode")
	}
	m, ok := got.(map[string]any)
	if !ok {
		t.Fatalf("unexpected JSON value type: %#v", got)
	}
	nested, ok := m["nested"].(map[string]any)
	if !ok || nested["flag"] != true {
		t.Fatalf("unexpected nested JSON value: %#v", m)
	}
}

func TestClient_GetDateTimeValue_ParsesISO8601(t *testing.T) {
	c := newCatalogFeatureValueClient(t)

	got, ok := c.GetDateTimeValue(context.Background(), "launch-at", Context{})
	if !ok {
		t.Fatal("expected GetDateTimeValue to decode")
	}
	if got.Year() != 2026 || got.Month() != time.June || got.Day() != 1 {
		t.Fatalf("unexpected parsed time: %v", got)
	}
}

func TestClient_GetDateTimeValue_SoftNullsOnUnparsableInput(t *testing.T) {
	c := newCatalogFeatureValueClient(t)

	if _, ok := c.GetDateTimeValue(context.Background(), "greeting", Context{}); ok {
		t.Fatal("expected GetDateTimeValue to soft-null for a string-declared flag")
	}
}

func TestClient_GetStringValue_SoftNullsOnDisabledFlag(t *testing.T) {
	c := newCatalogFeatureValueClient(t)

	if _, ok := c.GetStringValue(context.Background(), "disabled-greeting", Context{}); ok {
		t.Fatal("expected GetStringValue to soft-null for a disabled flag")
	}
}

func TestClient_GetStringValue_SoftNullsOnMissingFeature(t *testing.T) {
	c := newCatalogFeatureValueClient(t)

	const missingFeature = "does-not-exist"
	if _, ok := c.GetStringValue(context.Background(), missingFeature, Context{}); ok {
		t.Fatal("expected GetStringValue to soft-null for an unknown feature")
	}
	if _, ok := c.GetNumberValue(context.Background(), missingFeature, Context{}); ok {
		t.Fatal("expected GetNumberValue to soft-null for an unknown feature")
	}
	if _, ok := c.GetJSONValue(context.Background(), missingFeature, Context{}); ok {
		t.Fatal("expected GetJSONValue to soft-null for an unknown feature")
	}
	if _, ok := c.GetDateTimeValue(context.Background(), missingFeature, Context{}); ok {
		t.Fatal("expected GetDateTimeValue to soft-null for an unknown feature")
	}
}

func TestClient_GetStringValue_LegacyCatalogWithoutDeclaredValueType(t *testing.T) {
	c := newCatalogFeatureValueClient(t)

	got, ok := c.GetStringValue(context.Background(), "legacy-greeting", Context{})
	if !ok || got != "hello" {
		t.Fatalf("GetStringValue = %q, %v; want hello, true", got, ok)
	}
}
