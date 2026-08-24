package eval

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/definitions"
)

const contextPropertyFilter = "ContextProperty"

// EntityContext is the eval-package view of an entity instance.
type EntityContext struct {
	Kind       string
	Key        string
	Attributes map[string]any
}

func (e *EntityContext) attr(name string) (any, bool) {
	if e == nil || e.Attributes == nil {
		return nil, false
	}
	if v, ok := e.Attributes[name]; ok {
		return v, true
	}
	for k, v := range e.Attributes {
		if strings.EqualFold(k, name) {
			return v, true
		}
	}
	return nil, false
}

func isContextPropertyFilter(f definitions.FeatureFilter) bool {
	return strings.EqualFold(f.Name, contextPropertyFilter)
}

func splitFilters(def definitions.FeatureDefinitionModel) (entity, user []definitions.FeatureFilter) {
	for _, f := range def.Filters {
		if isContextPropertyFilter(f) {
			entity = append(entity, f)
		} else {
			user = append(user, f)
		}
	}
	return entity, user
}

func evaluateEntityFilters(def definitions.FeatureDefinitionModel, entity *EntityContext) bool {
	filters, _ := splitFilters(def)
	if len(filters) == 0 || entity == nil {
		return false
	}
	req := def.ContextRequirementType
	if req == "" {
		req = def.RequirementType
	}
	if req == "" {
		req = definitions.RequirementAny
	}
	if req == definitions.RequirementAll {
		for _, f := range filters {
			if !evaluateContextProperty(f.Parameters, entity) {
				return false
			}
		}
		return true
	}
	for _, f := range filters {
		if evaluateContextProperty(f.Parameters, entity) {
			return true
		}
	}
	return false
}

func paramString(params map[string]any, key string) (string, bool) {
	if params == nil {
		return "", false
	}
	if v, ok := params[key]; ok && v != nil {
		return fmt.Sprint(v), true
	}
	for k, v := range params {
		if strings.EqualFold(k, key) && v != nil {
			return fmt.Sprint(v), true
		}
	}
	return "", false
}

func evaluateContextProperty(params map[string]any, entity *EntityContext) bool {
	property, ok := paramString(params, "Property")
	op, okOp := paramString(params, "Operator")
	expected, okVal := paramString(params, "Value")
	if !ok || !okOp || !okVal || strings.TrimSpace(property) == "" || strings.TrimSpace(op) == "" {
		return false
	}
	valueType, _ := paramString(params, "ValueType")
	if valueType == "" {
		valueType = "string"
	}
	op = strings.ToLower(op)
	valueType = strings.ToLower(valueType)
	actual, found := entity.attr(property)
	if !found {
		return false
	}
	return compareContext(actual, op, expected, valueType)
}

func compareContext(actual any, op, expected, valueType string) bool {
	switch op {
	case "eq":
		return strings.EqualFold(fmt.Sprint(actual), expected)
	case "neq":
		return !strings.EqualFold(fmt.Sprint(actual), expected)
	case "gt", "gte", "lt", "lte":
		return compareOrdered(actual, expected, valueType, op)
	case "in":
		actualS := fmt.Sprint(actual)
		for _, c := range strings.Split(expected, ",") {
			c = strings.TrimSpace(c)
			if c != "" && strings.EqualFold(c, actualS) {
				return true
			}
		}
		return false
	case "contains":
		if valueType == "string[]" {
			switch t := actual.(type) {
			case []any:
				for _, v := range t {
					if strings.EqualFold(fmt.Sprint(v), expected) {
						return true
					}
				}
			case []string:
				for _, v := range t {
					if strings.EqualFold(v, expected) {
						return true
					}
				}
			}
			return false
		}
		return strings.Contains(strings.ToLower(fmt.Sprint(actual)), strings.ToLower(expected))
	default:
		return false
	}
}

func compareOrdered(actual any, expected, valueType, op string) bool {
	if valueType == "datetime" {
		a, okA := parseFlexibleTime(actual)
		e, okE := parseFlexibleTime(expected)
		if !okA || !okE {
			return false
		}
		switch op {
		case "gt":
			return a.After(e)
		case "gte":
			return a.After(e) || a.Equal(e)
		case "lt":
			return a.Before(e)
		case "lte":
			return a.Before(e) || a.Equal(e)
		}
		return false
	}
	if valueType == "number" {
		a, okA := toFloat(actual)
		e, okE := toFloat(expected)
		if !okA || !okE {
			return false
		}
		switch op {
		case "gt":
			return a > e
		case "gte":
			return a >= e
		case "lt":
			return a < e
		case "lte":
			return a <= e
		}
	}
	return false
}

func toFloat(v any) (float64, bool) {
	switch t := v.(type) {
	case float64:
		return t, true
	case float32:
		return float64(t), true
	case int:
		return float64(t), true
	case int64:
		return float64(t), true
	case json.Number:
		f, err := t.Float64()
		return f, err == nil
	case string:
		f, err := strconv.ParseFloat(t, 64)
		return f, err == nil
	default:
		f, err := strconv.ParseFloat(fmt.Sprint(v), 64)
		return f, err == nil
	}
}

func parseFlexibleTime(v any) (time.Time, bool) {
	if t, ok := v.(time.Time); ok {
		return t.UTC(), true
	}
	s := fmt.Sprint(v)
	layouts := []string{time.RFC3339Nano, time.RFC3339, "2006-01-02T15:04:05Z", "2006-01-02"}
	for _, l := range layouts {
		if t, err := time.Parse(l, s); err == nil {
			return t.UTC(), true
		}
	}
	return time.Time{}, false
}
