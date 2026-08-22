package eval

// Context carries evaluation context.
//
// It intentionally mirrors toggly.Context but lives in its own package to avoid cycles.
type Context struct {
	Identity string
	Groups   []string
	Traits   map[string]any
	Entity   *EntityContext
}
