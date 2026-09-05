package togglyhttp

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly"
	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/togglyctx"
)

type fakeEval struct {
	on  map[string]bool
	err error

	mu       sync.Mutex
	lastCtx  toggly.Context
	sawCalls []toggly.Context
}

func (f *fakeEval) IsEnabled(ctx context.Context, featureKey string, evalCtx toggly.Context) (bool, error) {
	_ = ctx
	f.mu.Lock()
	f.lastCtx = evalCtx
	f.sawCalls = append(f.sawCalls, evalCtx)
	f.mu.Unlock()
	if f.err != nil {
		return false, f.err
	}
	return f.on[featureKey], nil
}

func TestFromHttpRequest_MapsHeaders(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("User-Agent", "Mozilla/5.0")
	req.Header.Set("Accept-Language", "en-US")
	req.Header.Set("CF-IPCountry", "US")

	ctx := FromHttpRequest(req, toggly.Context{Identity: "u1"})
	if ctx.Identity != "u1" {
		t.Fatalf("identity: %q", ctx.Identity)
	}
	if ctx.Request == nil {
		t.Fatal("expected request")
	}
	if ctx.Request.UserAgent != "Mozilla/5.0" {
		t.Fatalf("ua: %q", ctx.Request.UserAgent)
	}
	if ctx.Request.AcceptLanguage != "en-US" {
		t.Fatalf("lang: %q", ctx.Request.AcceptLanguage)
	}
	if ctx.Request.Country != "US" {
		t.Fatalf("country: %q", ctx.Request.Country)
	}
}

func TestFromHttpRequest_CountryFallbackOrder(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-Vercel-IP-Country", "DE")
	req.Header.Set("CloudFront-Viewer-Country", "FR")
	ctx := FromHttpRequest(req)
	if ctx.Request.Country != "DE" {
		t.Fatalf("expected vercel country, got %q", ctx.Request.Country)
	}

	req2 := httptest.NewRequest(http.MethodGet, "/", nil)
	req2.Header.Set("CloudFront-Viewer-Country", "JP")
	ctx2 := FromHttpRequest(req2)
	if ctx2.Request.Country != "JP" {
		t.Fatalf("expected cloudfront country, got %q", ctx2.Request.Country)
	}
}

func TestMiddleware_StoresContext(t *testing.T) {
	mw := Middleware(func(r *http.Request) toggly.Context {
		_ = r
		return toggly.Context{Identity: "u1"}
	})

	h := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, ok := togglyctx.From(r.Context())
		if !ok || ctx.Identity != "u1" {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
}

func TestMiddleware_MergesRequestHeaders(t *testing.T) {
	mw := Middleware(func(r *http.Request) toggly.Context {
		return toggly.Context{Identity: "u1"}
	})

	h := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, ok := togglyctx.From(r.Context())
		if !ok || ctx.Request == nil || ctx.Request.UserAgent != "UA" || ctx.Request.Country != "CA" {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("User-Agent", "UA")
	req.Header.Set("CF-IPCountry", "CA")
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
}

func TestMiddlewareWith_ProvidersAndHeaderMerge(t *testing.T) {
	mw := MiddlewareWith(Options{
		GetIdentity: func(r *http.Request) string { return "user-1" },
		GetGroups:   func(r *http.Request) []string { return []string{"beta"} },
		GetClaims:   func(r *http.Request) map[string]string { return map[string]string{"role": "admin"} },
	})

	h := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, ok := togglyctx.From(r.Context())
		if !ok {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if ctx.Identity != "user-1" || len(ctx.Groups) != 1 || ctx.Claims["role"] != "admin" {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if ctx.Request == nil || ctx.Request.AcceptLanguage != "fr-FR" || ctx.Request.Country != "FR" {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Accept-Language", "fr-FR")
	req.Header.Set("CF-IPCountry", "FR")
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
}

func TestMiddlewareWith_GetContextKeepsSetRequestFields(t *testing.T) {
	mw := MiddlewareWith(Options{
		GetContext: func(r *http.Request) toggly.Context {
			return toggly.Context{
				Identity: "custom",
				Request:  &toggly.RequestContext{UserAgent: "CustomUA"},
			}
		},
	})

	h := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, ok := togglyctx.From(r.Context())
		if !ok || ctx.Identity != "custom" {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		// Custom UA kept; country filled from headers
		if ctx.Request.UserAgent != "CustomUA" || ctx.Request.Country != "GB" {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("User-Agent", "HeaderUA")
	req.Header.Set("CF-IPCountry", "GB")
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
}

func TestMiddleware_ConcurrentRequestIsolation(t *testing.T) {
	mw := MiddlewareWith(Options{
		GetIdentity: func(r *http.Request) string {
			return r.Header.Get("X-User")
		},
	})

	var mu sync.Mutex
	seen := map[string]string{}

	h := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, ok := togglyctx.From(r.Context())
		if !ok {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		key := r.Header.Get("X-User")
		mu.Lock()
		seen[key] = ctx.Identity
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
	}))

	const n = 50
	var wg sync.WaitGroup
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func(i int) {
			defer wg.Done()
			id := fmt.Sprintf("user-%d", i)
			rr := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req.Header.Set("X-User", id)
			req.Header.Set("CF-IPCountry", "US")
			h.ServeHTTP(rr, req)
			if rr.Code != http.StatusOK {
				t.Errorf("status %d for %s", rr.Code, id)
			}
		}(i)
	}
	wg.Wait()

	mu.Lock()
	defer mu.Unlock()
	if len(seen) != n {
		t.Fatalf("expected %d isolated contexts, got %d", n, len(seen))
	}
	for id, got := range seen {
		if got != id {
			t.Fatalf("identity leak: want %q got %q", id, got)
		}
	}
}

func TestFeatureGate_DeniesWhenOff(t *testing.T) {
	e := &fakeEval{on: map[string]bool{"On": true}}

	h := FeatureGate(e, "Off")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rr.Code)
	}
}

func TestFeatureGate_AllowsWhenOn(t *testing.T) {
	e := &fakeEval{on: map[string]bool{"On": true}}

	h := FeatureGate(e, "On")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
}

func TestFeatureGate_UsesAmbientContext(t *testing.T) {
	e := &fakeEval{on: map[string]bool{"On": true}}

	h := MiddlewareWith(Options{
		GetIdentity: func(r *http.Request) string { return "gate-user" },
	})(FeatureGate(e, "On")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})))

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("User-Agent", "GateUA")
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	if e.lastCtx.Identity != "gate-user" {
		t.Fatalf("expected ambient identity, got %#v", e.lastCtx)
	}
	if e.lastCtx.Request == nil || e.lastCtx.Request.UserAgent != "GateUA" {
		t.Fatalf("expected header request on gate eval: %#v", e.lastCtx.Request)
	}
}
