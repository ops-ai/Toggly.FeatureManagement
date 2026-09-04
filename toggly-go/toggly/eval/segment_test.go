package eval

import (
	"testing"

	"github.com/mileusna/useragent"
)

const chromeUA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
const iphoneUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

func TestBrowserFamily_StickyPercentage(t *testing.T) {
	e := BrowserFamilyEvaluator{}
	featureKey := "seg-browser"
	identity := "user-123"
	bucket := ComputePercentile(identity, featureKey)

	params := map[string]any{
		"Percentage":      bucket + 1,
		"BrowserFamily:0": "Chrome",
	}
	ctx := Context{
		Identity: identity,
		Request:  &RequestContext{UserAgent: chromeUA},
	}
	on, err := e.Evaluate(featureKey, params, ctx)
	if err != nil || !on {
		t.Fatalf("expected match: on=%v err=%v", on, err)
	}

	params["Percentage"] = bucket - 1
	if bucket-1 <= 0 {
		params["Percentage"] = float64(0)
	}
	off, err := e.Evaluate(featureKey, params, ctx)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if off {
		t.Fatalf("expected sticky gate to fail below bucket")
	}
}

func TestSegmentFilters_Basic(t *testing.T) {
	cases := []struct {
		name   string
		ev     Evaluator
		params map[string]any
		ctx    Context
		want   bool
	}{
		{
			name: "language",
			ev:   BrowserLanguageEvaluator{},
			params: map[string]any{
				"Percentage":        float64(100),
				"BrowserLanguage:0": "en-US",
			},
			ctx:  Context{Identity: "u", Request: &RequestContext{AcceptLanguage: "en-US,en;q=0.9"}},
			want: true,
		},
		{
			name: "country",
			ev:   CountryEvaluator{},
			params: map[string]any{
				"Percentage": float64(100),
				"Country:0":  "US",
			},
			ctx:  Context{Identity: "u", Request: &RequestContext{Country: "us"}},
			want: true,
		},
		{
			name: "os",
			ev:   OperatingSystemEvaluator{},
			params: map[string]any{
				"Percentage":        float64(100),
				"OperatingSystem:0": "macOS",
			},
			ctx:  Context{Identity: "u", Request: &RequestContext{UserAgent: chromeUA}},
			want: true,
		},
		{
			name: "device",
			ev:   DeviceTypeEvaluator{},
			params: map[string]any{
				"Percentage":   float64(100),
				"DeviceType:0": "iPhone",
			},
			ctx:  Context{Identity: "u", Request: &RequestContext{UserAgent: iphoneUA}},
			want: true,
		},
		{
			name: "claims",
			ev:   UserClaimsEvaluator{},
			params: map[string]any{
				"Percentage": float64(100),
				"Claim":      "role",
				"Value":      "admin",
			},
			ctx:  Context{Identity: "u", Claims: map[string]string{"role": "admin"}},
			want: true,
		},
		{
			name: "claims miss",
			ev:   UserClaimsEvaluator{},
			params: map[string]any{
				"Percentage": float64(100),
				"Claim":      "role",
				"Value":      "admin",
			},
			ctx:  Context{Identity: "u", Claims: map[string]string{"role": "user"}},
			want: false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := tc.ev.Evaluate("f", tc.params, tc.ctx)
			if err != nil {
				t.Fatalf("err: %v", err)
			}
			if got != tc.want {
				t.Fatalf("got %v want %v", got, tc.want)
			}
		})
	}
}

func TestDefaultRegistry_HasSegmentAliases(t *testing.T) {
	r := DefaultRegistry()
	for _, name := range []string{"BrowserFamily", "OS", "OperatingSystem", "CountryFamily", "Microsoft.Percentage"} {
		if _, ok := r.get(name); !ok {
			t.Fatalf("missing registry entry %s", name)
		}
	}
}

func TestPassesSegmentPercentageGate_Edges(t *testing.T) {
	if passesSegmentPercentageGate(50, false, "f", "u") {
		t.Fatal("missing percentage must fail")
	}
	if passesSegmentPercentageGate(0, true, "f", "u") {
		t.Fatal("percentage <= 0 must fail")
	}
	if passesSegmentPercentageGate(-1, true, "f", "u") {
		t.Fatal("negative percentage must fail")
	}
	if !passesSegmentPercentageGate(100, true, "f", "") {
		t.Fatal("percentage >= 100 must pass without identity")
	}
	if !passesSegmentPercentageGate(101, true, "f", "u") {
		t.Fatal("percentage > 100 must pass")
	}

	featureKey := "gate-feature"
	identity := "sticky-user"
	bucket := ComputePercentile(identity, featureKey)
	if !passesSegmentPercentageGate(bucket+1, true, featureKey, identity) {
		t.Fatalf("sticky identity should pass above bucket %.2f", bucket)
	}
	if passesSegmentPercentageGate(bucket, true, featureKey, identity) {
		t.Fatalf("sticky identity should fail at exact bucket %.2f (strict <)", bucket)
	}

	// Random path: no identity, partial percentage — just ensure it returns without panic.
	_ = passesSegmentPercentageGate(50, true, featureKey, "")
}

func TestSegmentFilters_EdgeBranches(t *testing.T) {
	chromeCtx := Context{Identity: "u", Request: &RequestContext{UserAgent: chromeUA}}
	emptyUACtx := Context{Identity: "u", Request: &RequestContext{UserAgent: ""}}
	nilReqCtx := Context{Identity: "u"}
	// Synthetic UA that mileusna cannot classify into a named browser → family "Other".
	otherUACtx := Context{Identity: "u", Request: &RequestContext{UserAgent: "TotallyUnknownAgent/1.0"}}

	cases := []struct {
		name   string
		ev     Evaluator
		params map[string]any
		ctx    Context
		want   bool
	}{
		{
			name:   "browser missing percentage",
			ev:     BrowserFamilyEvaluator{},
			params: map[string]any{"BrowserFamily:0": "Chrome"},
			ctx:    chromeCtx,
			want:   false,
		},
		{
			name:   "browser empty values",
			ev:     BrowserFamilyEvaluator{},
			params: map[string]any{"Percentage": float64(100)},
			ctx:    chromeCtx,
			want:   false,
		},
		{
			name:   "browser nil request",
			ev:     BrowserFamilyEvaluator{},
			params: map[string]any{"Percentage": float64(100), "BrowserFamily:0": "Chrome"},
			ctx:    nilReqCtx,
			want:   false,
		},
		{
			name:   "browser empty ua",
			ev:     BrowserFamilyEvaluator{},
			params: map[string]any{"Percentage": float64(100), "BrowserFamily:0": "Chrome"},
			ctx:    emptyUACtx,
			want:   false,
		},
		{
			name:   "browser family other",
			ev:     BrowserFamilyEvaluator{},
			params: map[string]any{"Percentage": float64(100), "BrowserFamily:0": "Chrome"},
			ctx:    otherUACtx,
			want:   false,
		},
		{
			name:   "browser no match",
			ev:     BrowserFamilyEvaluator{},
			params: map[string]any{"Percentage": float64(100), "BrowserFamily:0": "Firefox"},
			ctx:    chromeCtx,
			want:   false,
		},
		{
			name:   "language missing percentage",
			ev:     BrowserLanguageEvaluator{},
			params: map[string]any{"BrowserLanguage:0": "en"},
			ctx:    Context{Identity: "u", Request: &RequestContext{AcceptLanguage: "en-US"}},
			want:   false,
		},
		{
			name:   "language empty values",
			ev:     BrowserLanguageEvaluator{},
			params: map[string]any{"Percentage": float64(100)},
			ctx:    Context{Identity: "u", Request: &RequestContext{AcceptLanguage: "en-US"}},
			want:   false,
		},
		{
			name:   "language empty accept",
			ev:     BrowserLanguageEvaluator{},
			params: map[string]any{"Percentage": float64(100), "BrowserLanguage:0": "en"},
			ctx:    Context{Identity: "u", Request: &RequestContext{}},
			want:   false,
		},
		{
			name:   "language no match",
			ev:     BrowserLanguageEvaluator{},
			params: map[string]any{"Percentage": float64(100), "BrowserLanguage:0": "fr"},
			ctx:    Context{Identity: "u", Request: &RequestContext{AcceptLanguage: "en-US"}},
			want:   false,
		},
		{
			name:   "country missing percentage",
			ev:     CountryEvaluator{},
			params: map[string]any{"Country:0": "US"},
			ctx:    Context{Identity: "u", Request: &RequestContext{Country: "US"}},
			want:   false,
		},
		{
			name:   "country empty values",
			ev:     CountryEvaluator{},
			params: map[string]any{"Percentage": float64(100)},
			ctx:    Context{Identity: "u", Request: &RequestContext{Country: "US"}},
			want:   false,
		},
		{
			name:   "country empty",
			ev:     CountryEvaluator{},
			params: map[string]any{"Percentage": float64(100), "Country:0": "US"},
			ctx:    Context{Identity: "u", Request: &RequestContext{}},
			want:   false,
		},
		{
			name:   "country no match",
			ev:     CountryEvaluator{},
			params: map[string]any{"Percentage": float64(100), "Country:0": "CA"},
			ctx:    Context{Identity: "u", Request: &RequestContext{Country: "US"}},
			want:   false,
		},
		{
			name:   "device missing percentage",
			ev:     DeviceTypeEvaluator{},
			params: map[string]any{"DeviceType:0": "iPhone"},
			ctx:    Context{Identity: "u", Request: &RequestContext{UserAgent: iphoneUA}},
			want:   false,
		},
		{
			name:   "device empty values",
			ev:     DeviceTypeEvaluator{},
			params: map[string]any{"Percentage": float64(100)},
			ctx:    Context{Identity: "u", Request: &RequestContext{UserAgent: iphoneUA}},
			want:   false,
		},
		{
			name:   "device empty ua",
			ev:     DeviceTypeEvaluator{},
			params: map[string]any{"Percentage": float64(100), "DeviceType:0": "iPhone"},
			ctx:    emptyUACtx,
			want:   false,
		},
		{
			name:   "device family other",
			ev:     DeviceTypeEvaluator{},
			params: map[string]any{"Percentage": float64(100), "DeviceType:0": "iPhone"},
			ctx:    otherUACtx,
			want:   false,
		},
		{
			name:   "device no match",
			ev:     DeviceTypeEvaluator{},
			params: map[string]any{"Percentage": float64(100), "DeviceType:0": "iPad"},
			ctx:    Context{Identity: "u", Request: &RequestContext{UserAgent: iphoneUA}},
			want:   false,
		},
		{
			name:   "os missing percentage",
			ev:     OperatingSystemEvaluator{},
			params: map[string]any{"OperatingSystem:0": "macOS"},
			ctx:    chromeCtx,
			want:   false,
		},
		{
			name:   "os empty values",
			ev:     OperatingSystemEvaluator{},
			params: map[string]any{"Percentage": float64(100)},
			ctx:    chromeCtx,
			want:   false,
		},
		{
			name:   "os empty ua",
			ev:     OperatingSystemEvaluator{},
			params: map[string]any{"Percentage": float64(100), "OperatingSystem:0": "macOS"},
			ctx:    emptyUACtx,
			want:   false,
		},
		{
			name:   "os family other",
			ev:     OperatingSystemEvaluator{},
			params: map[string]any{"Percentage": float64(100), "OperatingSystem:0": "macOS"},
			ctx:    otherUACtx,
			want:   false,
		},
		{
			name:   "os no match",
			ev:     OperatingSystemEvaluator{},
			params: map[string]any{"Percentage": float64(100), "OperatingSystem:0": "Windows"},
			ctx:    chromeCtx,
			want:   false,
		},
		{
			name:   "claims missing percentage",
			ev:     UserClaimsEvaluator{},
			params: map[string]any{"Claim": "role", "Value": "admin"},
			ctx:    Context{Identity: "u", Claims: map[string]string{"role": "admin"}},
			want:   false,
		},
		{
			name:   "claims empty claim type",
			ev:     UserClaimsEvaluator{},
			params: map[string]any{"Percentage": float64(100), "Claim": "", "Value": "admin"},
			ctx:    Context{Identity: "u", Claims: map[string]string{"role": "admin"}},
			want:   false,
		},
		{
			name:   "claims nil map",
			ev:     UserClaimsEvaluator{},
			params: map[string]any{"Percentage": float64(100), "Claim": "role", "Value": "admin"},
			ctx:    Context{Identity: "u"},
			want:   false,
		},
		{
			name:   "claims missing key",
			ev:     UserClaimsEvaluator{},
			params: map[string]any{"Percentage": float64(100), "Claim": "role", "Value": "admin"},
			ctx:    Context{Identity: "u", Claims: map[string]string{"plan": "pro"}},
			want:   false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := tc.ev.Evaluate("f", tc.params, tc.ctx)
			if err != nil {
				t.Fatalf("err: %v", err)
			}
			if got != tc.want {
				t.Fatalf("got %v want %v", got, tc.want)
			}
		})
	}
}

func TestDeviceFamilyField_MobileNameFallback(t *testing.T) {
	// Android Chrome mobile often exposes Mobile=true with an empty Device string;
	// deviceFamilyField should fall back to ua.Name.
	androidUA := "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
	ua := useragent.Parse(androidUA)
	family := deviceFamilyField(ua)
	if family == "Other" || family == "" {
		t.Fatalf("expected mobile name fallback, got %q (device=%q name=%q mobile=%v)", family, ua.Device, ua.Name, ua.Mobile)
	}

	empty := useragent.Parse("")
	if deviceFamilyField(empty) != "Other" {
		t.Fatalf("empty UA device family want Other, got %q", deviceFamilyField(empty))
	}
	if browserFamilyField(empty) != "Other" {
		t.Fatalf("empty UA browser family want Other, got %q", browserFamilyField(empty))
	}
	if osFamilyField(empty) != "Other" {
		t.Fatalf("empty UA OS family want Other, got %q", osFamilyField(empty))
	}
}
