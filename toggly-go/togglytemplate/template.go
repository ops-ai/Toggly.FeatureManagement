package togglytemplate

import (
	"context"
	"html/template"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly"
)

// Evaluator is the minimal interface required by the template integration.
// *toggly.Client satisfies this interface.
type Evaluator interface {
	IsEnabled(ctx context.Context, featureKey string, evalCtx toggly.Context) (bool, error)
}

// ContextProvider can be implemented by template data types.
type ContextProvider interface {
	TogglyContext() toggly.Context
}

// ContextFromData extracts toggly.Context from common template data shapes.
func ContextFromData(data any) toggly.Context {
	switch v := data.(type) {
	case toggly.Context:
		return v
	case *toggly.Context:
		if v == nil {
			return toggly.Context{}
		}
		return *v
	case ContextProvider:
		return v.TogglyContext()
	default:
		return toggly.Context{}
	}
}

// FuncMap returns a template.FuncMap with helpers:
//
// - feature: {{ if (feature . "MyFeature") }} ... {{ end }}
// - featureAny: {{ if (featureAny . "A" "B") }} ... {{ end }}
// - featureAll: {{ if (featureAll . "A" "B") }} ... {{ end }}
func FuncMap(e Evaluator, ctxFromData func(any) toggly.Context) template.FuncMap {
	if ctxFromData == nil {
		ctxFromData = ContextFromData
	}

	feature := func(data any, key string) bool {
		if e == nil || key == "" {
			return false
		}
		enabled, _ := e.IsEnabled(context.Background(), key, ctxFromData(data))
		return enabled
	}

	featureAny := func(data any, keys ...string) bool {
		for _, k := range keys {
			if feature(data, k) {
				return true
			}
		}
		return false
	}

	featureAll := func(data any, keys ...string) bool {
		if len(keys) == 0 {
			return false
		}
		for _, k := range keys {
			if !feature(data, k) {
				return false
			}
		}
		return true
	}

	return template.FuncMap{
		"feature":    feature,
		"featureAny": featureAny,
		"featureAll": featureAll,
	}
}
