package eval

import "sync"

// Evaluator evaluates a feature filter.
type Evaluator interface {
	Evaluate(featureKey string, params map[string]any, ctx Context) (bool, error)
}

// Registry holds filter evaluators.
type Registry struct {
	mu    sync.RWMutex
	evals map[string]Evaluator
}

func NewRegistry() *Registry {
	return &Registry{evals: map[string]Evaluator{}}
}

func (r *Registry) Register(name string, e Evaluator) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.evals[name] = e
}

func (r *Registry) get(name string) (Evaluator, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	e, ok := r.evals[name]
	return e, ok
}
