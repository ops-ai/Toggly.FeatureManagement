package eval

import (
	"math/rand"
	"strings"

	"github.com/mileusna/useragent"
)

func passesSegmentPercentageGate(percentage float64, ok bool, featureKey, identity string) bool {
	if !ok || percentage <= 0 {
		return false
	}
	if percentage >= 100 {
		return true
	}
	if identity != "" {
		return ComputePercentile(identity, featureKey) < percentage
	}
	return rand.Float64()*100 < percentage
}

func containsIgnoreCase(haystack, needle string) bool {
	return strings.Contains(strings.ToLower(haystack), strings.ToLower(needle))
}

func browserFamilyField(ua useragent.UserAgent) string {
	if ua.Name == "" {
		return "Other"
	}
	return ua.Name
}

func osFamilyField(ua useragent.UserAgent) string {
	if ua.OS == "" {
		return "Other"
	}
	return ua.OS
}

func deviceFamilyField(ua useragent.UserAgent) string {
	// Prefer device name when present (iPhone, etc.); fall back to model-ish Name for mobiles.
	if ua.Device != "" {
		return ua.Device
	}
	if ua.Mobile || ua.Tablet {
		if ua.Name != "" {
			return ua.Name
		}
	}
	return "Other"
}

// BrowserFamilyEvaluator implements BrowserFamily.
type BrowserFamilyEvaluator struct{}

func (BrowserFamilyEvaluator) Evaluate(featureKey string, params map[string]any, ctx Context) (bool, error) {
	pct, ok := asFloat(params, "Percentage")
	if !passesSegmentPercentageGate(pct, ok, featureKey, ctx.Identity) {
		return false, nil
	}
	values := collectIndexedValues(params, []string{"BrowserFamily"})
	if len(values) == 0 {
		return false, nil
	}
	uaStr := ""
	if ctx.Request != nil {
		uaStr = ctx.Request.UserAgent
	}
	if uaStr == "" {
		return false, nil
	}
	ua := useragent.Parse(uaStr)
	family := browserFamilyField(ua)
	if family == "Other" {
		return false, nil
	}
	for _, v := range values {
		if containsIgnoreCase(family, v) {
			return true, nil
		}
	}
	return false, nil
}

// BrowserLanguageEvaluator implements BrowserLanguage.
type BrowserLanguageEvaluator struct{}

func (BrowserLanguageEvaluator) Evaluate(featureKey string, params map[string]any, ctx Context) (bool, error) {
	pct, ok := asFloat(params, "Percentage")
	if !passesSegmentPercentageGate(pct, ok, featureKey, ctx.Identity) {
		return false, nil
	}
	values := collectIndexedValues(params, []string{"BrowserLanguage"})
	if len(values) == 0 {
		return false, nil
	}
	accept := ""
	if ctx.Request != nil {
		accept = ctx.Request.AcceptLanguage
	}
	if accept == "" {
		return false, nil
	}
	for _, v := range values {
		if containsIgnoreCase(accept, v) {
			return true, nil
		}
	}
	return false, nil
}

// CountryEvaluator implements Country / CountryFamily.
type CountryEvaluator struct{}

func (CountryEvaluator) Evaluate(featureKey string, params map[string]any, ctx Context) (bool, error) {
	pct, ok := asFloat(params, "Percentage")
	if !passesSegmentPercentageGate(pct, ok, featureKey, ctx.Identity) {
		return false, nil
	}
	values := collectIndexedValues(params, []string{"Country"})
	if len(values) == 0 {
		return false, nil
	}
	country := ""
	if ctx.Request != nil {
		country = ctx.Request.Country
	}
	if country == "" {
		return false, nil
	}
	for _, v := range values {
		if strings.EqualFold(v, country) {
			return true, nil
		}
	}
	return false, nil
}

// DeviceTypeEvaluator implements DeviceType.
type DeviceTypeEvaluator struct{}

func (DeviceTypeEvaluator) Evaluate(featureKey string, params map[string]any, ctx Context) (bool, error) {
	pct, ok := asFloat(params, "Percentage")
	if !passesSegmentPercentageGate(pct, ok, featureKey, ctx.Identity) {
		return false, nil
	}
	values := collectIndexedValues(params, []string{"DeviceType"})
	if len(values) == 0 {
		return false, nil
	}
	uaStr := ""
	if ctx.Request != nil {
		uaStr = ctx.Request.UserAgent
	}
	if uaStr == "" {
		return false, nil
	}
	ua := useragent.Parse(uaStr)
	family := deviceFamilyField(ua)
	if family == "Other" {
		return false, nil
	}
	for _, v := range values {
		if containsIgnoreCase(family, v) {
			return true, nil
		}
	}
	return false, nil
}

// OperatingSystemEvaluator implements OS / OperatingSystem.
type OperatingSystemEvaluator struct{}

func (OperatingSystemEvaluator) Evaluate(featureKey string, params map[string]any, ctx Context) (bool, error) {
	pct, ok := asFloat(params, "Percentage")
	if !passesSegmentPercentageGate(pct, ok, featureKey, ctx.Identity) {
		return false, nil
	}
	values := collectIndexedValues(params, []string{"OperatingSystem"})
	if len(values) == 0 {
		return false, nil
	}
	uaStr := ""
	if ctx.Request != nil {
		uaStr = ctx.Request.UserAgent
	}
	if uaStr == "" {
		return false, nil
	}
	ua := useragent.Parse(uaStr)
	family := osFamilyField(ua)
	if family == "Other" {
		return false, nil
	}
	for _, v := range values {
		if containsIgnoreCase(family, v) {
			return true, nil
		}
	}
	return false, nil
}

// UserClaimsEvaluator implements UserClaims.
type UserClaimsEvaluator struct{}

func (UserClaimsEvaluator) Evaluate(featureKey string, params map[string]any, ctx Context) (bool, error) {
	pct, ok := asFloat(params, "Percentage")
	if !passesSegmentPercentageGate(pct, ok, featureKey, ctx.Identity) {
		return false, nil
	}
	claimType, _ := asString(params, "Claim")
	claimValue, _ := asString(params, "Value")
	if claimType == "" || claimValue == "" {
		return false, nil
	}
	if ctx.Claims == nil {
		return false, nil
	}
	actual, exists := ctx.Claims[claimType]
	if !exists {
		return false, nil
	}
	return actual == claimValue, nil
}

func collectIndexedValues(params map[string]any, prefixes []string) []string {
	var out []string
	for k, v := range params {
		for _, prefix := range prefixes {
			if !strings.HasPrefix(k, prefix+":") {
				continue
			}
			s, _ := asStringValue(v)
			if s != "" {
				out = append(out, s)
			}
			break
		}
	}
	return out
}
