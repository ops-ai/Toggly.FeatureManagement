package togglyctx

import (
	"context"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly"
)

// With returns a new context carrying the provided toggly.Context.
// Storage is shared with toggly.WithEvalContext so Client.IsEnabled can merge ambient.
func With(ctx context.Context, eval toggly.Context) context.Context {
	return toggly.WithEvalContext(ctx, eval)
}

// From extracts toggly.Context from the given context.
func From(ctx context.Context) (toggly.Context, bool) {
	return toggly.EvalContextFrom(ctx)
}

// Resolve merges ambient context from ctx with per-call overrides.
// Prefer Client.IsEnabled which resolves automatically; this helper is for
// callers that need the merged Context without evaluating.
func Resolve(ctx context.Context, perCall toggly.Context) toggly.Context {
	return toggly.ResolveEvalContext(ctx, perCall)
}

// Merge merges ambient defaults with a per-call Context.
// Per-call non-empty / non-nil fields win field-by-field.
func Merge(ambient, perCall toggly.Context) toggly.Context {
	return toggly.MergeContext(ambient, perCall)
}
