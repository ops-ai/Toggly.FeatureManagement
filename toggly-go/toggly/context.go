package toggly

// RequestContext carries HTTP request fields for segment filters.
type RequestContext struct {
	UserAgent      string
	AcceptLanguage string
	Country        string
}

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

	// Claims are principal / JWT-style claims for UserClaims filters.
	Claims map[string]string

	// Request holds HTTP headers used by segment identity filters.
	Request *RequestContext

	// Entity is the domain instance for ContextProperty filters.
	Entity *EntityContext
}
