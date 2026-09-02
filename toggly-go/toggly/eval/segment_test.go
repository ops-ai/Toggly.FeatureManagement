package eval

import (
	"testing"
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
