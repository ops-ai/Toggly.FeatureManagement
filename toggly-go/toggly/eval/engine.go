package eval

import (
	"encoding/json"
	"math/rand"
	"strconv"
	"time"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/definitions"
)

// Engine evaluates feature definitions.
type Engine struct {
	reg *Registry
	rng *rand.Rand
}

func NewEngine(reg *Registry) *Engine {
	if reg == nil {
		reg = NewRegistry()
	}
	return &Engine{reg: reg, rng: rand.New(rand.NewSource(time.Now().UnixNano()))}
}

// Evaluate returns whether a feature is enabled.
//
// Missing filters are ignored (treated as false), matching IgnoreMissingFeatureFilters behavior.
func (e *Engine) Evaluate(def definitions.FeatureDefinitionModel, ctx Context) (bool, error) {
	filters := def.Filters
	if len(filters) == 0 {
		return false, nil
	}

	entityFilters, userFilters := splitFilters(def)
	if len(entityFilters) > 0 {
		if ctx.Entity == nil {
			return false, nil
		}
		if !evaluateEntityFilters(def, ctx.Entity) {
			return false, nil
		}
		if len(userFilters) == 0 {
			return true, nil
		}
		return e.evaluateGroup(def.FeatureKey, userFilters, def.RequirementType, ctx)
	}
	return e.evaluateGroup(def.FeatureKey, userFilters, def.RequirementType, ctx)
}

func (e *Engine) evaluateGroup(featureKey string, filters []definitions.FeatureFilter, req definitions.RequirementType, ctx Context) (bool, error) {
	if len(filters) == 0 {
		return false, nil
	}
	if req == definitions.RequirementAll {
		return e.evaluateAll(featureKey, filters, ctx), nil
	}
	return e.evaluateAny(featureKey, filters, ctx), nil
}

func (e *Engine) evaluateAll(featureKey string, filters []definitions.FeatureFilter, ctx Context) bool {
	for _, f := range filters {
		ev, ok := e.reg.get(f.Name)
		if !ok {
			return false
		}
		okVal, err := ev.Evaluate(featureKey, f.Parameters, ctx)
		if err != nil || !okVal {
			return false
		}
	}
	return true
}

func (e *Engine) evaluateAny(featureKey string, filters []definitions.FeatureFilter, ctx Context) bool {
	for _, f := range filters {
		ev, ok := e.reg.get(f.Name)
		if !ok {
			continue
		}
		okVal, err := ev.Evaluate(featureKey, f.Parameters, ctx)
		if err == nil && okVal {
			return true
		}
	}
	return false
}

// RandFloat64 returns a float in [0,1) for evaluators that need randomness.
func (e *Engine) RandFloat64() float64 {
	if e == nil || e.rng == nil {
		return rand.Float64()
	}
	return e.rng.Float64()
}

func asFloat(params map[string]any, key string) (float64, bool) {
	v, ok := params[key]
	if !ok {
		return 0, false
	}
	switch t := v.(type) {
	case float64:
		return t, true
	case int:
		return float64(t), true
	case int64:
		return float64(t), true
	case json.Number:
		f, err := t.Float64()
		if err == nil {
			return f, true
		}
		return 0, false
	case string:
		f, err := strconv.ParseFloat(t, 64)
		if err != nil {
			return 0, false
		}
		return f, true
	default:
		return 0, false
	}
}

func asBool(params map[string]any, key string) (bool, bool) {
	v, ok := params[key]
	if !ok {
		return false, false
	}
	switch t := v.(type) {
	case bool:
		return t, true
	case string:
		switch t {
		case "true", "True", "1":
			return true, true
		case "false", "False", "0":
			return false, true
		default:
			return false, false
		}
	default:
		return false, false
	}
}
