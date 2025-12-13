package toggly

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/definitions"
)

func TestDefinitionsProvider_RefreshUnsigned_UsesETag(t *testing.T) {
	var calls int32
	var sawIfNoneMatch atomic.Value // string

	defsJSON := `[{"featureKey":"f1","filters":[{"name":"AlwaysOn","parameters":{}}],"metrics":[],"securedFeature":false,"clientSdkEnabled":true,"requirementType":"Any"}]`

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		if r.URL.Path != "/definitions/app/env" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if inm := r.Header.Get("If-None-Match"); inm != "" {
			sawIfNoneMatch.Store(inm)
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("ETag", `"1"`)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(defsJSON))
	}))
	defer srv.Close()

	cfg := Config{
		AppKey:       "app",
		Environment:  "env",
		BaseURL:      srv.URL + "/",
		HTTPTimeout:  2 * time.Second,
		RefreshInterval: time.Minute,
	}
	p := newDefinitionsProvider(cfg, nil)
	p.hc = srv.Client()

	if err := p.refreshUnsigned(context.Background()); err != nil {
		t.Fatalf("refresh 1: %v", err)
	}
	if err := p.refreshUnsigned(context.Background()); err != nil {
		t.Fatalf("refresh 2: %v", err)
	}

	if got := atomic.LoadInt32(&calls); got != 2 {
		t.Fatalf("expected 2 calls, got %d", got)
	}
	if v, _ := sawIfNoneMatch.Load().(string); v != `"1"` {
		t.Fatalf("expected If-None-Match to be %q, got %q", `"1"`, v)
	}

	if _, ok := p.get("f1"); !ok {
		t.Fatalf("expected definition to be cached")
	}
}

func TestDefinitionsDecode_Unsigned_CamelCase(t *testing.T) {
	defsJSON := []byte(`[{"featureKey":"f1","filters":[],"metrics":[],"securedFeature":false,"clientSdkEnabled":true,"requirementType":"Any"}]`)
	defs, err := definitions.DecodeUnsignedDefinitions(defsJSON)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(defs) != 1 || defs[0].FeatureKey != "f1" {
		t.Fatalf("unexpected defs: %#v", defs)
	}
}
