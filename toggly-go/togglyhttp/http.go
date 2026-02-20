package togglyhttp

import (
	"context"
	"net/http"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly"
	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/togglyctx"
)

// Evaluator is the minimal interface required by the HTTP integration.
// *toggly.Client satisfies this interface.
type Evaluator interface {
	IsEnabled(ctx context.Context, featureKey string, evalCtx toggly.Context) (bool, error)
}

// ContextBuilder builds a toggly.Context from an incoming request.
//
// Callers decide how identity/groups/traits are extracted.
type ContextBuilder func(r *http.Request) toggly.Context

// Middleware stores the evaluation context on the request context.
func Middleware(build ContextBuilder) func(http.Handler) http.Handler {
	if build == nil {
		build = func(*http.Request) toggly.Context { return toggly.Context{} }
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			evalCtx := build(r)
			r = r.WithContext(togglyctx.With(r.Context(), evalCtx))
			next.ServeHTTP(w, r)
		})
	}
}

// DenyHandler handles requests when a feature is disabled.
type DenyHandler func(w http.ResponseWriter, r *http.Request)

// ErrorHandler handles errors when evaluating a feature.
type ErrorHandler func(w http.ResponseWriter, r *http.Request, err error)

type gateConfig struct {
	buildCtx ContextBuilder
	onDeny   DenyHandler
	onError  ErrorHandler
}

// GateOption customizes FeatureGate.
type GateOption func(*gateConfig)

// WithContextBuilder configures a context builder to use when none is already stored.
func WithContextBuilder(b ContextBuilder) GateOption {
	return func(c *gateConfig) { c.buildCtx = b }
}

// WithDenyHandler configures the deny handler.
func WithDenyHandler(h DenyHandler) GateOption {
	return func(c *gateConfig) { c.onDeny = h }
}

// WithErrorHandler configures the error handler.
func WithErrorHandler(h ErrorHandler) GateOption {
	return func(c *gateConfig) { c.onError = h }
}

// FeatureGate returns middleware that only allows requests through if the given feature is enabled.
//
// By default:
// - deny => 404 Not Found
// - error => 503 Service Unavailable
// - evaluation context => extracted from request context (togglyctx.From)
func FeatureGate(e Evaluator, featureKey string, opts ...GateOption) func(http.Handler) http.Handler {
	cfg := gateConfig{
		onDeny: func(w http.ResponseWriter, r *http.Request) { http.NotFound(w, r) },
		onError: func(w http.ResponseWriter, r *http.Request, _ error) {
			http.Error(w, http.StatusText(http.StatusServiceUnavailable), http.StatusServiceUnavailable)
		},
	}
	for _, o := range opts {
		o(&cfg)
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if e == nil || featureKey == "" {
				cfg.onDeny(w, r)
				return
			}

			evalCtx, ok := togglyctx.From(r.Context())
			if !ok {
				if cfg.buildCtx != nil {
					evalCtx = cfg.buildCtx(r)
				}
			}

			enabled, err := e.IsEnabled(r.Context(), featureKey, evalCtx)
			if err != nil {
				cfg.onError(w, r, err)
				return
			}
			if !enabled {
				cfg.onDeny(w, r)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
