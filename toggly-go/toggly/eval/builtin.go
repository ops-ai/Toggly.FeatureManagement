package eval

import (
	"strings"
	"time"
)

// AlwaysOnEvaluator implements the AlwaysOn filter.
type AlwaysOnEvaluator struct{}

func (AlwaysOnEvaluator) Evaluate(featureKey string, params map[string]any, ctx Context) (bool, error) {
	_, _, _ = featureKey, params, ctx
	return true, nil
}

// AlwaysOffEvaluator implements the AlwaysOff filter (e.g. synthesized from evaluated variants).
type AlwaysOffEvaluator struct{}

func (AlwaysOffEvaluator) Evaluate(featureKey string, params map[string]any, ctx Context) (bool, error) {
	_, _, _ = featureKey, params, ctx
	return false, nil
}

// PercentageEvaluator implements Percentage.
type PercentageEvaluator struct{}

func (PercentageEvaluator) Evaluate(featureKey string, params map[string]any, ctx Context) (bool, error) {
	pct, ok := asFloat(params, "Value")
	if !ok {
		pct, _ = asFloat(params, "Percentage")
	}
	if pct <= 0 {
		return false, nil
	}
	if pct >= 100 {
		return true, nil
	}

	if ctx.Identity == "" {
		return false, nil
	}
	return ComputePercentile(ctx.Identity, featureKey) < pct, nil
}

// TimeWindowEvaluator implements TimeWindow.
type TimeWindowEvaluator struct {
	Now func() time.Time
}

func (t TimeWindowEvaluator) Evaluate(featureKey string, params map[string]any, ctx Context) (bool, error) {
	// Definitions parity: each side is optional; missing side is unconstrained;
	// neither Start nor End → true; invalid present side fails closed.
	_, _ = featureKey, ctx
	startS, _ := asString(params, "Start")
	endS, _ := asString(params, "End")
	now := time.Now().UTC()
	if t.Now != nil {
		now = t.Now().UTC()
	}

	if startS != "" {
		start, ok := parseTime(startS)
		if !ok || now.Before(start) {
			return false, nil
		}
	}

	if endS != "" {
		end, ok := parseTime(endS)
		if !ok || now.After(end) {
			return false, nil
		}
	}

	return true, nil
}

// TargetingEvaluator implements Targeting.
type TargetingEvaluator struct{}

func (TargetingEvaluator) Evaluate(featureKey string, params map[string]any, ctx Context) (bool, error) {
	ignoreCase, ok := asBool(params, "IgnoreCase")
	if !ok {
		ignoreCase = true // Definitions default
	}

	identity := ctx.Identity
	groups := ctx.Groups

	exclusionUsers := collectIndexedValues(params, []string{"Audience.Exclusion.Users", "Audience:Exclusion:Users"})
	if identity != "" && contains(exclusionUsers, identity, ignoreCase) {
		return false, nil
	}
	exclusionGroups := collectIndexedValues(params, []string{"Audience.Exclusion.Groups", "Audience:Exclusion:Groups"})
	if len(groups) > 0 {
		for _, eg := range exclusionGroups {
			if contains(groups, eg, ignoreCase) {
				return false, nil
			}
		}
	}

	if identity != "" {
		users := collectIndexedValues(params, []string{"Audience.Users", "Audience:Users"})
		if contains(users, identity, ignoreCase) {
			return true, nil
		}
	}

	if len(groups) > 0 {
		audienceGroups := collectIndexedValues(params, []string{"Audience.Groups", "Audience:Groups"})
		for _, g := range groups {
			if contains(audienceGroups, g, ignoreCase) {
				return true, nil
			}
		}
	}

	pct, ok := asFloat(params, "Audience.DefaultRolloutPercentage")
	if !ok {
		pct, _ = asFloat(params, "Percentage")
	}
	if pct <= 0 {
		return false, nil
	}
	if pct >= 100 {
		return true, nil
	}
	if identity == "" {
		return false, nil
	}

	return ComputePercentile(identity, featureKey) < pct, nil
}

func parseTime(s string) (time.Time, bool) {
	if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
		return t, true
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t, true
	}
	return time.Time{}, false
}

func contains(list []string, val string, ignoreCase bool) bool {
	for _, s := range list {
		if ignoreCase {
			if strings.EqualFold(s, val) {
				return true
			}
			continue
		}
		if s == val {
			return true
		}
	}
	return false
}

func asString(params map[string]any, key string) (string, bool) {
	v, ok := params[key]
	if !ok {
		return "", false
	}
	s, ok := asStringValue(v)
	return s, ok
}

func asStringValue(v any) (string, bool) {
	s, ok := v.(string)
	if ok {
		return s, true
	}
	return "", false
}

// NOTE: If you need a non-deterministic rollout, register a custom filter and
// implement your own sampling strategy.
