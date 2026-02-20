package togglyhttp

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly"
	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/togglyctx"
)

type fakeEval struct {
	on  map[string]bool
	err error
}

func (f fakeEval) IsEnabled(ctx context.Context, featureKey string, evalCtx toggly.Context) (bool, error) {
	_ = ctx
	_ = evalCtx
	if f.err != nil {
		return false, f.err
	}
	return f.on[featureKey], nil
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

func TestFeatureGate_DeniesWhenOff(t *testing.T) {
	e := fakeEval{on: map[string]bool{"On": true}}

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
	e := fakeEval{on: map[string]bool{"On": true}}

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
