package featurevalue

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/definitions"
)

func TestDecodeString(t *testing.T) {
	if s, ok := DecodeString("hello", ""); !ok || s != "hello" {
		t.Fatalf("DecodeString = %q, %v; want hello, true", s, ok)
	}
	if _, ok := DecodeString(42, ""); ok {
		t.Fatal("expected non-string input to soft-null")
	}
	if _, ok := DecodeString("hello", definitions.ValueTypeNumber); ok {
		t.Fatal(mismatchSoftNull)
	}
}

const mismatchSoftNull = "expected declared-type mismatch to soft-null"

func TestDecodeNumberFloatKinds(t *testing.T) {
	if n, ok := DecodeNumber(float64(42), ""); !ok || n != 42 {
		t.Fatalf("DecodeNumber float64 = %v, %v; want 42, true", n, ok)
	}
	if n, ok := DecodeNumber(float32(2), ""); !ok || n != 2 {
		t.Fatalf("DecodeNumber float32 = %v, %v; want 2, true", n, ok)
	}
	if n, ok := DecodeNumber(int(7), ""); !ok || n != 7 {
		t.Fatalf("DecodeNumber int = %v, %v; want 7, true", n, ok)
	}
	if n, ok := DecodeNumber(int64(9), ""); !ok || n != 9 {
		t.Fatalf("DecodeNumber int64 = %v, %v; want 9, true", n, ok)
	}
}

func TestDecodeNumberJSONAndStrings(t *testing.T) {
	if n, ok := DecodeNumber(json.Number("2.5"), ""); !ok || n != 2.5 {
		t.Fatalf("DecodeNumber json.Number = %v, %v; want 2.5, true", n, ok)
	}
	if _, ok := DecodeNumber(json.Number("not-a-number"), ""); ok {
		t.Fatal("expected invalid json.Number to soft-null")
	}
	if n, ok := DecodeNumber("3.14", ""); !ok || n != 3.14 {
		t.Fatalf("DecodeNumber string = %v, %v; want 3.14, true", n, ok)
	}
	if _, ok := DecodeNumber("   ", ""); ok {
		t.Fatal("expected blank numeric string to soft-null")
	}
}

func TestDecodeNumberRejects(t *testing.T) {
	if _, ok := DecodeNumber(true, ""); ok {
		t.Fatal("expected bool to never decode as a number")
	}
	if _, ok := DecodeNumber("not-a-number", ""); ok {
		t.Fatal("expected unparsable string to soft-null")
	}
	if _, ok := DecodeNumber([]byte("1"), ""); ok {
		t.Fatal("expected unsupported type to soft-null")
	}
	if _, ok := DecodeNumber(float64(42), definitions.ValueTypeString); ok {
		t.Fatal(mismatchSoftNull)
	}
}

func TestDecodeJSON(t *testing.T) {
	m := map[string]interface{}{"a": float64(1)}
	if v, ok := DecodeJSON(m, ""); !ok {
		t.Fatalf("expected map to decode, got ok=%v", ok)
	} else if got, ok := v.(map[string]interface{}); !ok || got["a"] != float64(1) {
		t.Fatalf("unexpected decoded value: %#v", v)
	}
	if v, ok := DecodeJSON(`{"a": 1}`, ""); !ok {
		t.Fatalf("expected JSON string to decode, got ok=%v", ok)
	} else if got, ok := v.(map[string]interface{}); !ok || got["a"] != float64(1) {
		t.Fatalf("unexpected decoded value: %#v", v)
	}
	if _, ok := DecodeJSON(nil, ""); ok {
		t.Fatal("expected nil JSON input to soft-null")
	}
	if _, ok := DecodeJSON(42, ""); ok {
		t.Fatal("expected unsupported JSON type to soft-null")
	}
	if _, ok := DecodeJSON("not json", ""); ok {
		t.Fatal("expected malformed JSON string to soft-null")
	}
	if _, ok := DecodeJSON(`"a plain string"`, ""); ok {
		t.Fatal("expected a bare JSON string literal to soft-null (not object/array)")
	}
	if _, ok := DecodeJSON(m, definitions.ValueTypeString); ok {
		t.Fatal(mismatchSoftNull)
	}
}

func TestDecodeDateTime(t *testing.T) {
	got, ok := DecodeDateTime("2026-01-15T10:30:00Z", "")
	if !ok {
		t.Fatal("expected ISO-8601 string to decode")
	}
	if got.Year() != 2026 || got.Month() != time.January || got.Day() != 15 {
		t.Fatalf("unexpected parsed time: %v", got)
	}
	existing := time.Date(2025, 3, 1, 0, 0, 0, 0, time.UTC)
	if passed, ok := DecodeDateTime(existing, ""); !ok || !passed.Equal(existing) {
		t.Fatalf("expected existing time.Time to pass through, got %v %v", passed, ok)
	}
	if _, ok := DecodeDateTime("   ", ""); ok {
		t.Fatal("expected blank datetime string to soft-null")
	}
	if _, ok := DecodeDateTime("not-a-date", ""); ok {
		t.Fatal("expected unparsable string to soft-null")
	}
	if _, ok := DecodeDateTime(12345, ""); ok {
		t.Fatal("expected non-string/time input to soft-null")
	}
	if _, ok := DecodeDateTime("2026-01-15T10:30:00Z", definitions.ValueTypeString); ok {
		t.Fatal(mismatchSoftNull)
	}
}

func TestValueTypeMatches(t *testing.T) {
	if !definitions.ValueType("").Matches(definitions.ValueTypeString) {
		t.Fatal("expected empty (legacy) declared type to allow any decode attempt")
	}
	if definitions.ValueTypeNumber.Matches(definitions.ValueTypeString) {
		t.Fatal("expected a declared mismatch to reject the decode attempt")
	}
	if !definitions.ValueTypeString.Matches(definitions.ValueTypeString) {
		t.Fatal("expected a matching declared type to allow the decode attempt")
	}
}
