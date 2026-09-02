package eval

import (
	"hash/fnv"
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
	_ = featureKey
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

	// Deterministic rollout based on identity only.
	// If Identity is not provided, Percentage cannot be evaluated reliably.
	if ctx.Identity == "" {
		return false, nil
	}
	return identityBucket(ctx.Identity) < pct, nil
}

// TimeWindowEvaluator implements TimeWindow.
type TimeWindowEvaluator struct {
	Now func() time.Time
}

func (t TimeWindowEvaluator) Evaluate(featureKey string, params map[string]any, ctx Context) (bool, error) {
	_, _ = featureKey, ctx
	startS, _ := asString(params, "Start")
	endS, _ := asString(params, "End")
	if startS == "" || endS == "" {
		return false, nil
	}
	start, ok := parseTime(startS)
	if !ok {
		return false, nil
	}
	end, ok := parseTime(endS)
	if !ok {
		return false, nil
	}
	now := time.Now().UTC()
	if t.Now != nil {
		now = t.Now().UTC()
	}
	return (now.Equal(start) || now.After(start)) && (now.Equal(end) || now.Before(end)), nil
}

// TargetingEvaluator implements Targeting.
type TargetingEvaluator struct{}

func (TargetingEvaluator) Evaluate(featureKey string, params map[string]any, ctx Context) (bool, error) {
	// Match Definitions default: IgnoreCase defaults to true when unset.
	ignoreCase, ok := asBool(params, "IgnoreCase")
	if !ok {
		ignoreCase = true
	}

	identity := ctx.Identity
	if identity != "" {
		exclusionUsers := collectPrefixedStrings(params, "Audience.Exclusion.Users", "Audience:Exclusion:Users")
		if contains(exclusionUsers, identity, ignoreCase) {
			return false, nil
		}
	}

	if len(ctx.Groups) > 0 {
		exclusionGroups := collectPrefixedStrings(params, "Audience.Exclusion.Groups", "Audience:Exclusion:Groups")
		for _, g := range ctx.Groups {
			if contains(exclusionGroups, g, ignoreCase) {
				return false, nil
			}
		}
	}

	if identity != "" {
		users := collectPrefixedStrings(params, "Audience.Users", "Audience:Users")
		if contains(users, identity, ignoreCase) {
			return true, nil
		}
	}

	if len(ctx.Groups) > 0 {
		groups := collectPrefixedStrings(params, "Audience.Groups", "Audience:Groups")
		for _, g := range ctx.Groups {
			if contains(groups, g, ignoreCase) {
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

	bucket := rolloutBucket(featureKey, identity)
	return bucket < pct, nil
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

func collectPrefixedStrings(params map[string]any, prefixes ...string) []string {
	var out []string
	for k, v := range params {
		matched := false
		for _, prefix := range prefixes {
			if strings.HasPrefix(k, prefix+":") {
				matched = true
				break
			}
		}
		if !matched {
			continue
		}
		s, _ := asStringValue(v)
		if s != "" {
			out = append(out, s)
		}
	}
	return out
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

func rolloutBucket(featureKey, identity string) float64 {
	h := fnv.New32a()
	_, _ = h.Write([]byte(featureKey))
	_, _ = h.Write([]byte{':'})
	_, _ = h.Write([]byte(identity))
	v := h.Sum32() % 10000
	return float64(v) / 100.0 // 0.00 - 99.99
}

func identityBucket(identity string) float64 {
	h := fnv.New32a()
	_, _ = h.Write([]byte(identity))
	v := h.Sum32() % 10000
	return float64(v) / 100.0 // 0.00 - 99.99
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
