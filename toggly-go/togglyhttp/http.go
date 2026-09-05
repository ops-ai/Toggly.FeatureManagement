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

// Options configures ambient EvalContext extraction for MiddlewareWith.
//
// Request headers (UA / Accept-Language / country) are always merged unless
// the returned context already sets those request fields.
type Options struct {
	// GetIdentity extracts the principal identity for the request.
	GetIdentity func(r *http.Request) string

	// GetGroups extracts group memberships for the request.
	GetGroups func(r *http.Request) []string

	// GetClaims extracts principal / JWT-style claims for UserClaims filters.
	GetClaims func(r *http.Request) map[string]string

	// GetContext returns a full evaluation context. When set, its fields are
	// used; missing request fields are still filled from HTTP headers.
	// GetIdentity / GetGroups / GetClaims are ignored when GetContext is set.
	GetContext func(r *http.Request) toggly.Context
}

// BuildContext builds ambient EvalContext from Options and HTTP headers.
func BuildContext(r *http.Request, opts Options) toggly.Context {
	if r == nil {
		r = &http.Request{}
	}

	if opts.GetContext != nil {
		custom := opts.GetContext(r)
		custom.Request = mergeRequestFromHeaders(r.Header, custom.Request)
		return custom
	}

	var out toggly.Context
	if opts.GetIdentity != nil {
		out.Identity = opts.GetIdentity(r)
	}
	if opts.GetGroups != nil {
		out.Groups = opts.GetGroups(r)
	}
	if opts.GetClaims != nil {
		out.Claims = opts.GetClaims(r)
	}
	out.Request = requestFromHeaders(r.Header)
	return out
}

// Middleware stores the evaluation context on the request context.
func Middleware(build ContextBuilder) func(http.Handler) http.Handler {
	if build == nil {
		build = func(r *http.Request) toggly.Context {
			return FromHttpRequest(r)
		}
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			evalCtx := build(r)
			// Always enrich missing request fields from headers unless already set.
			evalCtx.Request = mergeRequestFromHeaders(r.Header, evalCtx.Request)
			r = r.WithContext(togglyctx.With(r.Context(), evalCtx))
			next.ServeHTTP(w, r)
		})
	}
}

// MiddlewareWith stores ambient EvalContext built from Options (providers + headers).
func MiddlewareWith(opts Options) func(http.Handler) http.Handler {
	return Middleware(func(r *http.Request) toggly.Context {
		return BuildContext(r, opts)
	})
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
//   - deny => 404 Not Found
//   - error => 503 Service Unavailable
//   - evaluation context => extracted from request context (togglyctx.From);
//     Client.IsEnabled also merges ambient from context with any per-call overrides.
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
					evalCtx.Request = mergeRequestFromHeaders(r.Header, evalCtx.Request)
				} else {
					evalCtx = FromHttpRequest(r)
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
