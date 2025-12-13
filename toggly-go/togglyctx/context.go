package togglyctx

import (
	"context"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly"
)

type key struct{}

// With returns a new context carrying the provided toggly.Context.
func With(ctx context.Context, eval toggly.Context) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, key{}, eval)
}

// From extracts toggly.Context from the given context.
func From(ctx context.Context) (toggly.Context, bool) {
	if ctx == nil {
		return toggly.Context{}, false
	}
	v := ctx.Value(key{})
	if v == nil {
		return toggly.Context{}, false
	}
	eval, ok := v.(toggly.Context)
	return eval, ok
}
