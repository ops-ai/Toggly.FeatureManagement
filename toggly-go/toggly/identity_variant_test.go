package toggly

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestGetVariant_UsesConfigIdentity(t *testing.T) {
	c := newCatalogVariantsClientWithConfigIdentity(t, "alice")
	v, err := c.GetVariant(context.Background(), "checkout-flow", Context{})
	if err != nil {
		t.Fatalf("GetVariant: %v", err)
	}
	if v == nil || v.Name != "A" {
		t.Fatalf("got %+v, want variant A from config identity", v)
	}
}

func TestGetVariant_SetIdentityOverridesConfig(t *testing.T) {
	c := newCatalogVariantsClientWithConfigIdentity(t, "carol")
	c.SetIdentity("alice")
	v, err := c.GetVariant(context.Background(), "checkout-flow", Context{})
	if err != nil {
		t.Fatalf("GetVariant: %v", err)
	}
	if v == nil || v.Name != "A" {
		t.Fatalf("got %+v, want A after SetIdentity", v)
	}
}

func TestGetVariant_AmbientOverridesClientIdentity(t *testing.T) {
	c := newCatalogVariantsClientWithConfigIdentity(t, "carol")
	ctx := WithEvalContext(context.Background(), Context{Identity: "alice"})
	v, err := c.GetVariant(ctx, "checkout-flow", Context{})
	if err != nil {
		t.Fatalf("GetVariant: %v", err)
	}
	if v == nil || v.Name != "A" {
		t.Fatalf("got %+v, want A from ambient", v)
	}
}

func TestGetVariant_PerCallOverridesAmbientAndConfig(t *testing.T) {
	c := newCatalogVariantsClientWithConfigIdentity(t, "carol")
	ctx := WithEvalContext(context.Background(), Context{Identity: "bob"})
	v, err := c.GetVariant(ctx, "checkout-flow", Context{Identity: "alice"})
	if err != nil {
		t.Fatalf("GetVariant: %v", err)
	}
	if v == nil || v.Name != "A" {
		t.Fatalf("got %+v, want A from per-call", v)
	}
}

func TestGetVariant_EmptyIdentityFallsBackToDefaultWhenEnabled(t *testing.T) {
	c := newCatalogVariantsClient(t)
	v, err := c.GetVariant(context.Background(), "checkout-flow", Context{})
	if err != nil {
		t.Fatalf("GetVariant: %v", err)
	}
	if v == nil || v.Name != "B" {
		t.Fatalf("got %+v, want defaultWhenEnabled B", v)
	}
}

func TestIdentity_RoundTrip(t *testing.T) {
	c := newCatalogVariantsClientWithConfigIdentity(t, "start")
	if c.Identity() != "start" {
		t.Fatalf("Identity()=%q", c.Identity())
	}
	c.SetIdentity("next")
	if c.Identity() != "next" {
		t.Fatalf("after SetIdentity Identity()=%q", c.Identity())
	}
}

func TestGetVariant_HTTPAmbientPreferredOverConfig(t *testing.T) {
	c := newCatalogVariantsClientWithConfigIdentity(t, "carol")
	var gotName string
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		v, err := c.GetVariant(r.Context(), "checkout-flow", Context{})
		if err != nil {
			t.Errorf("GetVariant: %v", err)
			return
		}
		if v != nil {
			gotName = v.Name
		}
	})
	wrapped := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := WithEvalContext(r.Context(), Context{Identity: "alice"})
		h.ServeHTTP(w, r.WithContext(ctx))
	})
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rr := httptest.NewRecorder()
	wrapped.ServeHTTP(rr, req)
	if gotName != "A" {
		t.Fatalf("got %q, want A from HTTP ambient", gotName)
	}
}

func newCatalogVariantsClientWithConfigIdentity(t *testing.T, identity string) *Client {
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
		Identity:                 identity,
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
