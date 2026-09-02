package eval

// DefaultRegistry returns a registry preloaded with built-in evaluators.
func DefaultRegistry() *Registry {
	r := NewRegistry()

	// Deterministic on.
	r.Register("AlwaysOn", AlwaysOnEvaluator{})

	// Deterministic off.
	r.Register("AlwaysOff", AlwaysOffEvaluator{})

	// Percentage rollout.
	r.Register("Percentage", PercentageEvaluator{})
	r.Register("Microsoft.Percentage", PercentageEvaluator{})

	// Time window.
	r.Register("TimeWindow", TimeWindowEvaluator{})
	r.Register("Microsoft.TimeWindow", TimeWindowEvaluator{})

	// Targeting.
	r.Register("Targeting", TargetingEvaluator{})
	r.Register("Microsoft.Targeting", TargetingEvaluator{})

	return r
}
