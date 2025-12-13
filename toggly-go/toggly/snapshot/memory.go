package snapshot

import (
	"context"
	"sync"
)

// MemoryProvider stores snapshots in memory.
// Useful for tests.
type MemoryProvider struct {
	mu   sync.RWMutex
	defs *DefinitionsSnapshot
	jwks *JWKSnap
}

func NewMemoryProvider() *MemoryProvider { return &MemoryProvider{} }

func (m *MemoryProvider) LoadDefinitions(ctx context.Context) (*DefinitionsSnapshot, error) {
	_ = ctx
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.defs == nil {
		return nil, nil
	}
	cpy := *m.defs
	return &cpy, nil
}

func (m *MemoryProvider) SaveDefinitions(ctx context.Context, snap DefinitionsSnapshot) error {
	_ = ctx
	m.mu.Lock()
	defer m.mu.Unlock()
	m.defs = &snap
	return nil
}

func (m *MemoryProvider) LoadJWKS(ctx context.Context) (*JWKSnap, error) {
	_ = ctx
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.jwks == nil {
		return nil, nil
	}
	cpy := *m.jwks
	return &cpy, nil
}

func (m *MemoryProvider) SaveJWKS(ctx context.Context, snap JWKSnap) error {
	_ = ctx
	m.mu.Lock()
	defer m.mu.Unlock()
	m.jwks = &snap
	return nil
}
