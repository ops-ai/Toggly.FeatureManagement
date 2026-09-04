package eval

// DefaultRegistry returns a registry preloaded with built-in evaluators.
func DefaultRegistry() *Registry {
	r := NewRegistry()

	r.Register("AlwaysOn", AlwaysOnEvaluator{})
	r.Register("AlwaysOff", AlwaysOffEvaluator{})
	r.Register("Percentage", PercentageEvaluator{})
	r.Register("Microsoft.Percentage", PercentageEvaluator{})
	r.Register("TimeWindow", TimeWindowEvaluator{})
	r.Register("Microsoft.TimeWindow", TimeWindowEvaluator{})
	r.Register("Targeting", TargetingEvaluator{})
	r.Register("Microsoft.Targeting", TargetingEvaluator{})

	r.Register("BrowserFamily", BrowserFamilyEvaluator{})
	r.Register("BrowserLanguage", BrowserLanguageEvaluator{})
	r.Register("Country", CountryEvaluator{})
	r.Register("CountryFamily", CountryEvaluator{})
	r.Register("DeviceType", DeviceTypeEvaluator{})
	r.Register("OS", OperatingSystemEvaluator{})
	r.Register("OperatingSystem", OperatingSystemEvaluator{})
	r.Register("UserClaims", UserClaimsEvaluator{})

	return r
}
