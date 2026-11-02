package eval

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/definitions"
)

const filterParityDirRel = "docs/filter-parity/fixtures"

// knownFilterParityFailures lists fixture IDs that diverge from shared golden
// expectations. Do not change evaluation behavior to force a pass; skip with a
// clear reason and document the case in the PR. Currently empty — all fixtures pass.
var knownFilterParityFailures = map[string]string{}

var requiredFilterParityIDs = []string{
	"browser-family-match",
	"browser-family-miss",
	"browser-language-match",
	"country-from-request",
	"country-from-cf-ipcountry",
	"device-type-match",
	"os-match",
	"user-claims-match",
	"user-claims-miss",
	"targeting-groups-match",
	"percentage-missing-fail-closed",
	"percentage-zero-fail-closed",
	"unknown-filter-fail-closed",
}

type filterParityFixture struct {
	ID              string            `json:"id"`
	Description     string            `json:"description"`
	FeatureKey      string            `json:"featureKey"`
	RequirementType string            `json:"requirementType"`
	Filters         []fixtureFilter   `json:"filters"`
	Context         json.RawMessage   `json:"context"`
	HTTPHeaders     map[string]string `json:"httpHeaders"`
	Expected        bool              `json:"expected"`
}

type fixtureFilter struct {
	Name       string         `json:"name"`
	Parameters map[string]any `json:"parameters"`
}

type fixtureContext struct {
	Identity string            `json:"identity"`
	Groups   []string          `json:"groups"`
	Claims   map[string]string `json:"claims"`
	Traits   map[string]any    `json:"traits"`
	Request  *struct {
		UserAgent      string `json:"userAgent"`
		AcceptLanguage string `json:"acceptLanguage"`
		Country        string `json:"country"`
	} `json:"request"`
}

func firstExistingDir(paths []string) string {
	for _, candidate := range paths {
		if st, err := os.Stat(candidate); err == nil && st.IsDir() {
			if abs, err := filepath.Abs(candidate); err == nil {
				return abs
			}
			return candidate
		}
	}
	return ""
}

func walkForDir(start, rel string, maxDepth int) string {
	walk := start
	for i := 0; i < maxDepth; i++ {
		candidate := filepath.Join(walk, rel)
		if st, err := os.Stat(candidate); err == nil && st.IsDir() {
			if abs, err := filepath.Abs(candidate); err == nil {
				return abs
			}
			return candidate
		}
		parent := filepath.Dir(walk)
		if parent == walk {
			break
		}
		walk = parent
	}
	return ""
}

func resolveFilterParityFixturesDir(t *testing.T) string {
	t.Helper()
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	candidates := []string{
		filepath.Join(cwd, filterParityDirRel),
		filepath.Join(cwd, "..", filterParityDirRel),
		filepath.Join(cwd, "..", "..", filterParityDirRel),
		filepath.Join(cwd, "..", "..", "..", filterParityDirRel),
		filepath.Join(cwd, "..", "..", "..", "..", filterParityDirRel),
	}
	if found := firstExistingDir(candidates); found != "" {
		return found
	}
	if found := walkForDir(cwd, filterParityDirRel, 6); found != "" {
		return found
	}
	t.Fatal(filterParityDirRel + " not found")
	return ""
}

func loadFilterParityFixtures(t *testing.T) []filterParityFixture {
	t.Helper()
	dir := resolveFilterParityFixturesDir(t)
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read fixtures dir %s: %v", dir, err)
	}
	var fixtures []filterParityFixture
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		path := filepath.Join(dir, entry.Name())
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		var fixture filterParityFixture
		if err := json.Unmarshal(data, &fixture); err != nil {
			t.Fatalf("parse %s: %v", path, err)
		}
		fixtures = append(fixtures, fixture)
	}
	if len(fixtures) == 0 {
		t.Fatalf("no fixtures found in %s", dir)
	}
	return fixtures
}

func toDefinition(fixture filterParityFixture) definitions.FeatureDefinitionModel {
	req := definitions.RequirementAny
	if strings.EqualFold(fixture.RequirementType, "All") {
		req = definitions.RequirementAll
	}
	filters := make([]definitions.FeatureFilter, 0, len(fixture.Filters))
	for _, f := range fixture.Filters {
		params := f.Parameters
		if params == nil {
			params = map[string]any{}
		}
		filters = append(filters, definitions.FeatureFilter{Name: f.Name, Parameters: params})
	}
	return definitions.FeatureDefinitionModel{
		FeatureKey:      fixture.FeatureKey,
		Filters:         filters,
		RequirementType: req,
	}
}

func toEvalContext(fixture filterParityFixture) Context {
	var base Context
	if len(fixture.Context) > 0 && string(fixture.Context) != "null" {
		var raw fixtureContext
		if err := json.Unmarshal(fixture.Context, &raw); err == nil {
			base.Identity = raw.Identity
			base.Groups = raw.Groups
			base.Claims = raw.Claims
			base.Traits = raw.Traits
			if raw.Request != nil {
				base.Request = &RequestContext{
					UserAgent:      raw.Request.UserAgent,
					AcceptLanguage: raw.Request.AcceptLanguage,
					Country:        raw.Request.Country,
				}
			}
		}
	}
	if len(fixture.HTTPHeaders) == 0 {
		return base
	}
	return mergeHTTPHeadersIntoContext(fixture.HTTPHeaders, base)
}

// mergeHTTPHeadersIntoContext mirrors togglyhttp FromHttpRequest / mergeRequestFromHeaders
// for fixture httpHeaders without importing the HTTP adapter package.
func mergeHTTPHeadersIntoContext(headers map[string]string, base Context) Context {
	h := make(http.Header, len(headers))
	for k, v := range headers {
		h.Set(k, v)
	}
	fromHeaders := &RequestContext{
		UserAgent:      strings.TrimSpace(h.Get("User-Agent")),
		AcceptLanguage: strings.TrimSpace(h.Get("Accept-Language")),
		Country: firstNonEmpty(
			strings.TrimSpace(h.Get("CF-IPCountry")),
			strings.TrimSpace(h.Get("X-Vercel-IP-Country")),
			strings.TrimSpace(h.Get("CloudFront-Viewer-Country")),
		),
	}
	if base.Request == nil {
		base.Request = fromHeaders
		return base
	}
	out := *fromHeaders
	if base.Request.UserAgent != "" {
		out.UserAgent = base.Request.UserAgent
	}
	if base.Request.AcceptLanguage != "" {
		out.AcceptLanguage = base.Request.AcceptLanguage
	}
	if base.Request.Country != "" {
		out.Country = base.Request.Country
	}
	base.Request = &out
	return base
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

func TestFilterParityLoadsRequiredWave1Cases(t *testing.T) {
	ids := map[string]struct{}{}
	for _, fixture := range loadFilterParityFixtures(t) {
		ids[fixture.ID] = struct{}{}
	}
	for _, required := range requiredFilterParityIDs {
		if _, ok := ids[required]; !ok {
			t.Fatalf("missing fixture %s", required)
		}
	}
}

func TestFilterParityGoldenFixtures(t *testing.T) {
	engine := NewEngine(DefaultRegistry())
	for _, fixture := range loadFilterParityFixtures(t) {
		fixture := fixture
		t.Run(fixture.ID, func(t *testing.T) {
			if reason, known := knownFilterParityFailures[fixture.ID]; known {
				t.Skipf("known filter-parity divergence (behavior unchanged): %s", reason)
			}
			def := toDefinition(fixture)
			ctx := toEvalContext(fixture)
			actual, err := engine.Evaluate(def, ctx)
			if err != nil {
				t.Fatalf("evaluate: %v", err)
			}
			if actual != fixture.Expected {
				t.Fatalf("%s: expected %v, got %v (%s)", fixture.ID, fixture.Expected, actual, fixture.Description)
			}
		})
	}
}
