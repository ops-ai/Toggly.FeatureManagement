package toggly

import "context"

type evalContextKey struct{}

// WithEvalContext returns a child context carrying request-scoped evaluation context.
// Prefer togglyctx.With for HTTP middleware; this is the storage used by IsEnabled.
func WithEvalContext(ctx context.Context, eval Context) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, evalContextKey{}, eval)
}

// EvalContextFrom extracts request-scoped evaluation context, if present.
func EvalContextFrom(ctx context.Context) (Context, bool) {
	if ctx == nil {
		return Context{}, false
	}
	v := ctx.Value(evalContextKey{})
	if v == nil {
		return Context{}, false
	}
	eval, ok := v.(Context)
	return eval, ok
}

// MergeContext merges ambient defaults with a per-call Context.
// Per-call non-empty / non-nil fields win field-by-field (JS ambient merge semantics).
func MergeContext(ambient, perCall Context) Context {
	out := ambient

	if perCall.Identity != "" {
		out.Identity = perCall.Identity
	}
	if perCall.Groups != nil {
		out.Groups = perCall.Groups
	}
	if perCall.Traits != nil {
		out.Traits = perCall.Traits
	}
	if perCall.Claims != nil {
		out.Claims = perCall.Claims
	}
	if perCall.Request != nil {
		out.Request = perCall.Request
	}
	if perCall.Entity != nil {
		out.Entity = perCall.Entity
	}

	return out
}

// ResolveEvalContext merges ambient context from ctx with perCall overrides.
// When no ambient is bound, returns perCall unchanged.
func ResolveEvalContext(ctx context.Context, perCall Context) Context {
	ambient, ok := EvalContextFrom(ctx)
	if !ok {
		return perCall
	}
	return MergeContext(ambient, perCall)
}
