package definitions

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestDecodeDefinitionsPreservesNumbersAndSignedPayload(t *testing.T) {
	const raw = `[{"featureKey":"checkout","filters":[{"name":"Percentage","parameters":{"Value":9007199254740993}}]}]`
	defs, err := DecodeUnsignedDefinitions([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	value, ok := defs[0].Filters[0].Parameters["Value"].(json.Number)
	if !ok || value.String() != "9007199254740993" {
		t.Fatalf("decoded percentage = %#v, want lossless json.Number", defs[0].Filters[0].Parameters["Value"])
	}
	if _, err := DecodeUnsignedDefinitions([]byte(`{`)); err == nil {
		t.Fatal("malformed unsigned definitions were accepted")
	}

	envelope, err := DecodeSignedDefinitions([]byte(`{"defs":` + raw + `,"signature":"signed"}`))
	if err != nil {
		t.Fatal(err)
	}
	if string(envelope.Defs) != raw {
		t.Fatalf("signed payload changed: %s", envelope.Defs)
	}
	parsed, err := DecodeSignedDefsPayload(envelope.Defs)
	if err != nil || parsed[0].FeatureKey != "checkout" {
		t.Fatalf("decoded signed definitions = %#v, %v", parsed, err)
	}
	for _, bad := range []string{`{`, `{"signature":"signed"}`} {
		if _, err := DecodeSignedDefinitions([]byte(bad)); err == nil || !strings.Contains(err.Error(), "signed definitions envelope") {
			t.Fatalf("signed envelope %q: error = %v", bad, err)
		}
	}
}
