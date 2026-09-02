package eval

// RequestContext carries HTTP request fields for segment filters.
type RequestContext struct {
	UserAgent      string
	AcceptLanguage string
	Country        string
}

// Context carries evaluation context.
//
// It intentionally mirrors toggly.Context but lives in its own package to avoid cycles.
type Context struct {
	Identity string
	Groups   []string
	Traits   map[string]any
	Claims   map[string]string
	Request  *RequestContext
	Entity   *EntityContext
}
