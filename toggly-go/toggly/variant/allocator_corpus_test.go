package variant

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/definitions"
)

// corpusCase mirrors one entry of variant-allocator-corpus/cases.json (repo
// root). See variant-allocator-corpus/README.md for the full schema.
//
// NOTE: the corpus's "feature.enabledFor" is *not* the SDK's own "filters"
// wire shape (it mirrors .NET's FeatureDefinition.EnabledFor for the oracle
// harness); every fixture only ever uses a bare AlwaysOn/absent filter, so a
// non-empty list is exactly baseEnabled=true and doesn't need the eval engine.
type corpusCase struct {
	ID         string          `json:"id"`
	Feature    corpusFeature   `json:"feature"`
	Targeting  corpusTargeting `json:"targeting"`
	Expected   corpusExpected  `json:"expected"`
	IgnoreCase bool            `json:"ignoreCase"`
}

type corpusFeature struct {
	Name       string                            `json:"name"`
	EnabledFor []corpusFilter                    `json:"enabledFor"`
	Variants   []definitions.VariantDefinition   `json:"variants"`
	Allocation *definitions.AllocationDefinition `json:"allocation"`
}

type corpusFilter struct {
	Name string `json:"name"`
}

type corpusTargeting struct {
	UserID *string  `json:"userId"`
	Groups []string `json:"groups"`
}

type corpusExpected struct {
	VariantName        *string     `json:"variantName"`
	ConfigurationValue interface{} `json:"configurationValue"`
	Enabled            bool        `json:"enabled"`
	AssignmentReason   string      `json:"assignmentReason"`
}

// TestAssign_GoldCorpus replays variant-allocator-corpus/cases.json (captured
// from the real Microsoft.FeatureManagement 4.7.0 FeatureManager) and asserts
// an exact match on variant name, configuration value, effective enabled
// state, and assignment reason for every case.
func TestAssign_GoldCorpus(t *testing.T) {
	path := findCorpusPath(t)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read corpus: %v", err)
	}

	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var cases []corpusCase
	if err := dec.Decode(&cases); err != nil {
		t.Fatalf("decode corpus: %v", err)
	}
	if len(cases) == 0 {
		t.Fatal("corpus has no cases")
	}

	for _, c := range cases {
		c := c
		t.Run(c.ID, func(t *testing.T) {
			def := definitions.FeatureDefinitionModel{
				FeatureKey: c.Feature.Name,
				Variants:   c.Feature.Variants,
				Allocation: c.Feature.Allocation,
			}
			baseEnabled := len(c.Feature.EnabledFor) > 0

			var userID string
			if c.Targeting.UserID != nil {
				userID = *c.Targeting.UserID
			}
			targeting := TargetingContext{UserID: userID, Groups: c.Targeting.Groups}

			got := Assign(def, baseEnabled, targeting, c.IgnoreCase)

			var gotName string
			var gotConfig interface{}
			if got.Variant != nil {
				gotName = got.Variant.Name
				gotConfig = got.Variant.ConfigurationValue
			}
			var wantName string
			if c.Expected.VariantName != nil {
				wantName = *c.Expected.VariantName
			}

			if gotName != wantName {
				t.Errorf("variant name: got %q want %q", gotName, wantName)
			}
			if !reflect.DeepEqual(gotConfig, c.Expected.ConfigurationValue) {
				t.Errorf("configurationValue: got %#v want %#v", gotConfig, c.Expected.ConfigurationValue)
			}
			if got.Enabled != c.Expected.Enabled {
				t.Errorf("enabled: got %v want %v", got.Enabled, c.Expected.Enabled)
			}
			if string(got.Reason) != c.Expected.AssignmentReason {
				t.Errorf("assignmentReason: got %q want %q", got.Reason, c.Expected.AssignmentReason)
			}
		})
	}
}

// findCorpusPath walks upward from the working directory (the package's
// source directory under `go test`) to locate the repo-root
// variant-allocator-corpus/cases.json, so this test does not depend on how
// deep this package lives relative to the repo root.
func findCorpusPath(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	for i := 0; i < 12; i++ {
		candidate := filepath.Join(dir, "variant-allocator-corpus", "cases.json")
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	t.Fatalf("could not find variant-allocator-corpus/cases.json above %s", dir)
	return ""
}
