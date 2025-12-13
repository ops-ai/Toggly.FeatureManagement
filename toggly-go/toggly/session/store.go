package session

import (
	"context"
	"sync"
	"time"
)

// Store persists per-identity feature decisions for a limited time.
type Store interface {
	Get(ctx context.Context, identity, featureKey string) (*bool, error)
	Set(ctx context.Context, identity, featureKey string, enabled bool, ttl time.Duration) error
}

// MemoryStore is a simple in-memory store (process-local).
//
// This is useful for demos/tests; production typically uses Redis or another shared store.
type MemoryStore struct {
	mu sync.Mutex
	m  map[string]entry
}

type entry struct {
	v      bool
	expires time.Time
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{m: map[string]entry{}}
}

func (s *MemoryStore) key(identity, featureKey string) string { return identity + "|" + featureKey }

func (s *MemoryStore) Get(ctx context.Context, identity, featureKey string) (*bool, error) {
	_ = ctx
	s.mu.Lock()
	defer s.mu.Unlock()
	k := s.key(identity, featureKey)
	e, ok := s.m[k]
	if !ok {
		return nil, nil
	}
	if time.Now().After(e.expires) {
		delete(s.m, k)
		return nil, nil
	}
	v := e.v
	return &v, nil
}

func (s *MemoryStore) Set(ctx context.Context, identity, featureKey string, enabled bool, ttl time.Duration) error {
	_ = ctx
	s.mu.Lock()
	defer s.mu.Unlock()
	s.m[s.key(identity, featureKey)] = entry{v: enabled, expires: time.Now().Add(ttl)}
	return nil
}
