package session

import (
	"context"
	"testing"
	"time"
)

func TestMemoryStoreScopesDecisionsAndExpiresThem(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	if value, err := store.Get(ctx, "user-a", "flag"); err != nil || value != nil {
		t.Fatalf("missing decision = %v, %v", value, err)
	}
	if err := store.Set(ctx, "user-a", "flag", false, time.Hour); err != nil {
		t.Fatal(err)
	}
	if err := store.Set(ctx, "user-b", "flag", true, time.Hour); err != nil {
		t.Fatal(err)
	}
	if value, err := store.Get(ctx, "user-a", "flag"); err != nil || value == nil || *value {
		t.Fatalf("user-a decision = %v, %v", value, err)
	}
	if value, err := store.Get(ctx, "user-b", "flag"); err != nil || value == nil || !*value {
		t.Fatalf("user-b decision = %v, %v", value, err)
	}
	if err := store.Set(ctx, "user-a", "flag", true, 0); err != nil {
		t.Fatal(err)
	}
	if value, err := store.Get(ctx, "user-a", "flag"); err != nil || value != nil {
		t.Fatalf("expired decision = %v, %v", value, err)
	}
}
