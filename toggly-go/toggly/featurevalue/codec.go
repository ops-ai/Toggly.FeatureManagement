// Package featurevalue soft-decodes a resolved feature's value by its
// declared catalog [definitions.ValueType] (OPS-2102).
//
// Mirrors the wire contract used across Toggly SDKs: a feature definition
// may carry a valueType of "boolean" | "string" | "number" | "json" |
// "datetime". These helpers never panic solely for a shape mismatch and
// never return a wrong-typed value — they soft-null (zero value, false) on a
// declared-type mismatch or a decode failure. Legacy catalogs without a
// declared valueType (empty definitions.ValueType) still attempt the decode
// so older flags keep working.
//
// Reuses the same soft-null shape as the OPS-1365 variant value codec
// (GetVariantValueAs), applied to the flag's own value rather than a
// variant's configuration payload.
package featurevalue

import (
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/definitions"
)

// DecodeString soft-decodes raw as a string. Returns ("", false) on a
// declared-type mismatch or a non-string value.
func DecodeString(raw interface{}, declared definitions.ValueType) (string, bool) {
	if !declared.Matches(definitions.ValueTypeString) {
		return "", false
	}
	s, ok := raw.(string)
	return s, ok
}

// DecodeNumber soft-decodes raw as a finite float64. Returns (0, false) on a
// declared-type mismatch, a non-numeric value, or an unparsable string.
// Booleans are never treated as 0/1.
func DecodeNumber(raw interface{}, declared definitions.ValueType) (float64, bool) {
	if !declared.Matches(definitions.ValueTypeNumber) {
		return 0, false
	}
	switch v := raw.(type) {
	case bool:
		return 0, false
	case float64:
		return v, true
	case float32:
		return float64(v), true
	case int:
		return float64(v), true
	case int64:
		return float64(v), true
	case json.Number:
		f, err := v.Float64()
		if err != nil {
			return 0, false
		}
		return f, true
	case string:
		trimmed := strings.TrimSpace(v)
		if trimmed == "" {
			return 0, false
		}
		f, err := strconv.ParseFloat(trimmed, 64)
		if err != nil {
			return 0, false
		}
		return f, true
	default:
		return 0, false
	}
}

// DecodeJSON soft-decodes raw as a parsed JSON object/array (map[string]any
// or []any). Returns (nil, false) on a declared-type mismatch or an
// undecodable value.
func DecodeJSON(raw interface{}, declared definitions.ValueType) (interface{}, bool) {
	if !declared.Matches(definitions.ValueTypeJSON) {
		return nil, false
	}
	switch v := raw.(type) {
	case nil:
		return nil, false
	case map[string]interface{}, []interface{}:
		return v, true
	case string:
		var parsed interface{}
		if err := json.Unmarshal([]byte(v), &parsed); err != nil {
			return nil, false
		}
		switch parsed.(type) {
		case map[string]interface{}, []interface{}:
			return parsed, true
		default:
			return nil, false
		}
	default:
		return nil, false
	}
}

// DecodeDateTime soft-decodes raw as a time.Time parsed from an ISO-8601
// (RFC 3339) string. Returns (zero time, false) on a declared-type
// mismatch, a non-string/time input, or an unparsable value.
func DecodeDateTime(raw interface{}, declared definitions.ValueType) (time.Time, bool) {
	if !declared.Matches(definitions.ValueTypeDateTime) {
		return time.Time{}, false
	}
	switch v := raw.(type) {
	case time.Time:
		return v, true
	case string:
		trimmed := strings.TrimSpace(v)
		if trimmed == "" {
			return time.Time{}, false
		}
		t, err := time.Parse(time.RFC3339, trimmed)
		if err != nil {
			return time.Time{}, false
		}
		return t, true
	default:
		return time.Time{}, false
	}
}
