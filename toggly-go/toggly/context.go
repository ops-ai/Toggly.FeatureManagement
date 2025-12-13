package toggly

// Context carries evaluation context for a feature check.
//
// It is intentionally simple and transport-agnostic (HTTP, gRPC, jobs, etc.).
type Context struct {
	// Identity should be a stable unique identifier for the user/device/requester.
	Identity string

	// Groups are optional group identifiers (plan, cohort, org, etc.).
	Groups []string

	// Traits are arbitrary attributes used by targeting rules.
	Traits map[string]any
}
