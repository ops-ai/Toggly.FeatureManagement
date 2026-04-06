package toggly

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/eval"
)

func TestDefinitionsProvider_RefreshEvaluatedVariants_UsesETagAndUserId(t *testing.T) {
	var calls int32
	var sawIfNoneMatch atomic.Value // string
	var sawPath atomic.Value        // string
	var sawRawQuery atomic.Value    // string

	payload := `{"defs":{"f1":{"enabled":true,"variant":"control","configurationValue":"x"}},"signature":"","timestamp":100,"kid":""}`

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		sawPath.Store(r.URL.Path)
		sawRawQuery.Store(r.URL.RawQuery)
		if r.URL.Path != "/evaluated-variants-signed/app/env" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if inm := r.Header.Get("If-None-Match"); inm != "" {
			sawIfNoneMatch.Store(inm)
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("ETag", `"v1"`)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(payload))
	}))
	defer srv.Close()

	cfg := Config{
		AppKey:          "app",
		Environment:     "env",
		DefinitionsURL:  srv.URL + "/",
		HTTPTimeout:     2 * time.Second,
		RefreshInterval: time.Minute,
		EnableVariants:  true,
		VariantIdentity: "user%40x",
	}
	p := newDefinitionsProvider(cfg, nil)
	p.hc = srv.Client()

	if err := p.refreshEvaluatedVariants(context.Background()); err != nil {
		t.Fatalf("refresh 1: %v", err)
	}
	if err := p.refreshEvaluatedVariants(context.Background()); err != nil {
		t.Fatalf("refresh 2: %v", err)
	}

	if got := atomic.LoadInt32(&calls); got != 2 {
		t.Fatalf("expected 2 calls, got %d", got)
	}
	if v, _ := sawIfNoneMatch.Load().(string); v != `"v1"` {
		t.Fatalf("expected If-None-Match %q, got %q", `"v1"`, v)
	}
	if v, _ := sawPath.Load().(string); v != "/evaluated-variants-signed/app/env" {
		t.Fatalf("unexpected path: %q", v)
	}
	if v, _ := sawRawQuery.Load().(string); v != "userId=user%2540x" {
		t.Fatalf("unexpected query: %q", v)
	}

	def, ok := p.get("f1")
	if !ok {
		t.Fatal("expected definition f1")
	}
	eng := eval.NewEngine(eval.DefaultRegistry())
	on, err := eng.Evaluate(def, eval.Context{})
	if err != nil {
		t.Fatalf("eval: %v", err)
	}
	if !on {
		t.Fatal("expected f1 enabled from variant defs")
	}

	v := p.getVariant("f1")
	if v == nil || v.Name != "control" || v.ConfigurationValue != "x" {
		t.Fatalf("unexpected variant: %#v", v)
	}
}

func TestClient_SetVariantIdentity_ClearsVariantETag(t *testing.T) {
	var calls int32
	payload := `{"defs":{"f1":{"enabled":true,"variant":"a","configurationValue":null}},"signature":"","timestamp":200,"kid":""}`

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		if r.Header.Get("If-None-Match") != "" {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("ETag", `"e"`)
		_, _ = w.Write([]byte(payload))
	}))
	defer srv.Close()

	cfg := Config{
		AppKey:               "k",
		Environment:        "e",
		DefinitionsURL:       srv.URL + "/",
		HTTPTimeout:          2 * time.Second,
		RefreshInterval:      time.Hour,
		EnableVariants:       true,
		DisableBackgroundRefresh: true,
	}
	c, err := NewClient(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = c.Close() }()

	c.provider.hc = srv.Client()
	if err := c.provider.refreshEvaluatedVariants(context.Background()); err != nil {
		t.Fatalf("refresh 1: %v", err)
	}
	if err := c.provider.refreshEvaluatedVariants(context.Background()); err != nil {
		t.Fatalf("refresh 2: %v", err)
	}
	if atomic.LoadInt32(&calls) != 2 {
		t.Fatalf("expected 2 calls before identity change, got %d", atomic.LoadInt32(&calls))
	}

	c.SetVariantIdentity("other")
	if err := c.provider.refreshEvaluatedVariants(context.Background()); err != nil {
		t.Fatalf("refresh 3: %v", err)
	}
	if atomic.LoadInt32(&calls) != 3 {
		t.Fatalf("expected 3rd fetch after identity change, got %d", atomic.LoadInt32(&calls))
	}
}
