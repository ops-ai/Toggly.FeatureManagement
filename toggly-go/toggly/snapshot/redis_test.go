package snapshot

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/definitions"
	"github.com/redis/go-redis/v9"
)

func getRedisClient(t *testing.T) *redis.Client {
	t.Helper()
	addr := os.Getenv("REDIS_TEST_ADDR")
	if addr == "" {
		t.Skip("REDIS_TEST_ADDR not set, skipping Redis tests")
	}
	client := redis.NewClient(&redis.Options{
		Addr: addr,
	})
	// Test connection
	if err := client.Ping(context.Background()).Err(); err != nil {
		t.Skipf("cannot connect to Redis at %s: %v", addr, err)
	}
	return client
}

func cleanupRedisKeys(t *testing.T, client *redis.Client, prefix string) {
	t.Helper()
	ctx := context.Background()
	keys, _ := client.Keys(ctx, prefix+":*").Result()
	if len(keys) > 0 {
		client.Del(ctx, keys...)
	}
}

func TestRedisProvider_LoadDefinitions_WhenEmpty(t *testing.T) {
	client := getRedisClient(t)
	defer client.Close()

	prefix := "test_empty"
	cleanupRedisKeys(t, client, prefix)
	defer cleanupRedisKeys(t, client, prefix)

	provider := NewRedisProvider(RedisOptions{
		Client: client,
		Prefix: prefix,
	})
	snap, err := provider.LoadDefinitions(context.Background())

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if snap != nil {
		t.Fatalf("expected nil snapshot, got %+v", snap)
	}
}

func TestRedisProvider_SaveAndLoadDefinitions(t *testing.T) {
	client := getRedisClient(t)
	defer client.Close()

	prefix := "test_save_load"
	cleanupRedisKeys(t, client, prefix)
	defer cleanupRedisKeys(t, client, prefix)

	provider := NewRedisProvider(RedisOptions{
		Client: client,
		Prefix: prefix,
	})
	ctx := context.Background()

	input := DefinitionsSnapshot{
		Defs: []definitions.FeatureDefinitionModel{
			{
				FeatureKey: "feature1",
				Filters: []definitions.FeatureFilter{
					{Name: "AlwaysOn"},
				},
			},
			{
				FeatureKey: "feature2",
				Filters: []definitions.FeatureFilter{
					{Name: "Percentage", Parameters: map[string]any{"Value": "50"}},
				},
			},
		},
		Signature: "test-signature",
		Kid:       "key-123",
		Timestamp: 1700000000,
	}

	// Save
	err := provider.SaveDefinitions(ctx, input)
	if err != nil {
		t.Fatalf("failed to save definitions: %v", err)
	}

	// Load
	snap, err := provider.LoadDefinitions(ctx)
	if err != nil {
		t.Fatalf("failed to load definitions: %v", err)
	}

	if snap == nil {
		t.Fatal("expected snapshot, got nil")
	}
	if len(snap.Defs) != 2 {
		t.Fatalf("expected 2 definitions, got %d", len(snap.Defs))
	}
	if snap.Defs[0].FeatureKey != "feature1" {
		t.Errorf("expected feature1, got %s", snap.Defs[0].FeatureKey)
	}
	if snap.Signature != "test-signature" {
		t.Errorf("expected test-signature, got %s", snap.Signature)
	}
	if snap.Kid != "key-123" {
		t.Errorf("expected key-123, got %s", snap.Kid)
	}
	if snap.Timestamp != 1700000000 {
		t.Errorf("expected 1700000000, got %d", snap.Timestamp)
	}
}

func TestRedisProvider_SaveDefinitions_Updates(t *testing.T) {
	client := getRedisClient(t)
	defer client.Close()

	prefix := "test_update"
	cleanupRedisKeys(t, client, prefix)
	defer cleanupRedisKeys(t, client, prefix)

	provider := NewRedisProvider(RedisOptions{
		Client: client,
		Prefix: prefix,
	})
	ctx := context.Background()

	// Save first version
	input1 := DefinitionsSnapshot{
		Defs: []definitions.FeatureDefinitionModel{
			{FeatureKey: "feature1"},
		},
		Signature: "sig-1",
	}
	if err := provider.SaveDefinitions(ctx, input1); err != nil {
		t.Fatalf("failed to save first version: %v", err)
	}

	// Save second version (update)
	input2 := DefinitionsSnapshot{
		Defs: []definitions.FeatureDefinitionModel{
			{FeatureKey: "updated-feature"},
		},
		Signature: "sig-2",
	}
	if err := provider.SaveDefinitions(ctx, input2); err != nil {
		t.Fatalf("failed to save second version: %v", err)
	}

	// Load and verify
	snap, err := provider.LoadDefinitions(ctx)
	if err != nil {
		t.Fatalf("failed to load definitions: %v", err)
	}

	if len(snap.Defs) != 1 {
		t.Fatalf("expected 1 definition, got %d", len(snap.Defs))
	}
	if snap.Defs[0].FeatureKey != "updated-feature" {
		t.Errorf("expected updated-feature, got %s", snap.Defs[0].FeatureKey)
	}
	if snap.Signature != "sig-2" {
		t.Errorf("expected sig-2, got %s", snap.Signature)
	}
}

func TestRedisProvider_LoadJWKS_WhenEmpty(t *testing.T) {
	client := getRedisClient(t)
	defer client.Close()

	prefix := "test_jwks_empty"
	cleanupRedisKeys(t, client, prefix)
	defer cleanupRedisKeys(t, client, prefix)

	provider := NewRedisProvider(RedisOptions{
		Client: client,
		Prefix: prefix,
	})
	snap, err := provider.LoadJWKS(context.Background())

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if snap != nil {
		t.Fatalf("expected nil snapshot, got %+v", snap)
	}
}

func TestRedisProvider_SaveAndLoadJWKS(t *testing.T) {
	client := getRedisClient(t)
	defer client.Close()

	prefix := "test_jwks_save"
	cleanupRedisKeys(t, client, prefix)
	defer cleanupRedisKeys(t, client, prefix)

	provider := NewRedisProvider(RedisOptions{
		Client: client,
		Prefix: prefix,
	})
	ctx := context.Background()

	expiry := time.Now().Add(24 * time.Hour).Truncate(time.Second)
	input := JWKSnap{
		Set: definitions.JWKSet{
			Keys: []definitions.JWK{
				{
					Kid: "test-key-id",
					Kty: "EC",
					Crv: "P-256",
					X:   "test-x",
					Y:   "test-y",
					Use: "sig",
					Alg: "ES256",
				},
			},
		},
		Expiry: expiry,
	}

	// Save
	err := provider.SaveJWKS(ctx, input)
	if err != nil {
		t.Fatalf("failed to save JWKS: %v", err)
	}

	// Load
	snap, err := provider.LoadJWKS(ctx)
	if err != nil {
		t.Fatalf("failed to load JWKS: %v", err)
	}

	if snap == nil {
		t.Fatal("expected snapshot, got nil")
	}
	if len(snap.Set.Keys) != 1 {
		t.Fatalf("expected 1 key, got %d", len(snap.Set.Keys))
	}
	if snap.Set.Keys[0].Kid != "test-key-id" {
		t.Errorf("expected test-key-id, got %s", snap.Set.Keys[0].Kid)
	}
	// Compare Unix timestamps to avoid precision issues
	if snap.Expiry.Unix() != expiry.Unix() {
		t.Errorf("expected expiry %v, got %v", expiry.Unix(), snap.Expiry.Unix())
	}
}

func TestRedisProvider_WithTTL(t *testing.T) {
	client := getRedisClient(t)
	defer client.Close()

	prefix := "test_ttl"
	cleanupRedisKeys(t, client, prefix)
	defer cleanupRedisKeys(t, client, prefix)

	provider := NewRedisProvider(RedisOptions{
		Client: client,
		Prefix: prefix,
		TTL:    1 * time.Hour,
	})
	ctx := context.Background()

	input := DefinitionsSnapshot{
		Defs: []definitions.FeatureDefinitionModel{
			{FeatureKey: "feature1"},
		},
	}
	if err := provider.SaveDefinitions(ctx, input); err != nil {
		t.Fatalf("failed to save: %v", err)
	}

	// Check TTL is set
	ttl, err := client.TTL(ctx, prefix+":definitions").Result()
	if err != nil {
		t.Fatalf("failed to get TTL: %v", err)
	}
	if ttl <= 0 {
		t.Errorf("expected positive TTL, got %v", ttl)
	}
	if ttl > 1*time.Hour {
		t.Errorf("expected TTL <= 1 hour, got %v", ttl)
	}
}

func TestRedisProvider_WithoutTTL(t *testing.T) {
	client := getRedisClient(t)
	defer client.Close()

	prefix := "test_no_ttl"
	cleanupRedisKeys(t, client, prefix)
	defer cleanupRedisKeys(t, client, prefix)

	provider := NewRedisProvider(RedisOptions{
		Client: client,
		Prefix: prefix,
		TTL:    0, // No TTL
	})
	ctx := context.Background()

	input := DefinitionsSnapshot{
		Defs: []definitions.FeatureDefinitionModel{
			{FeatureKey: "feature1"},
		},
	}
	if err := provider.SaveDefinitions(ctx, input); err != nil {
		t.Fatalf("failed to save: %v", err)
	}

	// Check no TTL is set (returns -1 for no expiration)
	ttl, err := client.TTL(ctx, prefix+":definitions").Result()
	if err != nil {
		t.Fatalf("failed to get TTL: %v", err)
	}
	if ttl != -1 {
		t.Errorf("expected no expiration (-1), got %v", ttl)
	}
}

func TestRedisProvider_DefaultPrefix(t *testing.T) {
	client := getRedisClient(t)
	defer client.Close()

	cleanupRedisKeys(t, client, "toggly")
	defer cleanupRedisKeys(t, client, "toggly")

	provider := NewRedisProvider(RedisOptions{
		Client: client,
		// Prefix not set, should default to "toggly"
	})

	if provider.prefix != "toggly" {
		t.Errorf("expected default prefix 'toggly', got %s", provider.prefix)
	}
}

func TestRedisProvider_KeyGeneration(t *testing.T) {
	client := getRedisClient(t)
	defer client.Close()

	provider := NewRedisProvider(RedisOptions{
		Client: client,
		Prefix: "myapp",
	})

	if provider.definitionsKey() != "myapp:definitions" {
		t.Errorf("expected 'myapp:definitions', got %s", provider.definitionsKey())
	}
	if provider.jwksKey() != "myapp:jwks" {
		t.Errorf("expected 'myapp:jwks', got %s", provider.jwksKey())
	}
}

func TestRedisProvider_ImplementsInterface(t *testing.T) {
	client := getRedisClient(t)
	defer client.Close()

	var _ Provider = NewRedisProvider(RedisOptions{Client: client})
}

func TestRedisProvider_RoundTrip(t *testing.T) {
	client := getRedisClient(t)
	defer client.Close()

	prefix := "test_roundtrip"
	cleanupRedisKeys(t, client, prefix)
	defer cleanupRedisKeys(t, client, prefix)

	provider := NewRedisProvider(RedisOptions{
		Client: client,
		Prefix: prefix,
	})
	ctx := context.Background()

	defs := DefinitionsSnapshot{
		Defs: []definitions.FeatureDefinitionModel{
			{FeatureKey: "feature1"},
			{FeatureKey: "feature2"},
		},
		Signature: "sig",
		Kid:       "kid",
		Timestamp: 1700000000,
	}
	jwks := JWKSnap{
		Set: definitions.JWKSet{
			Keys: []definitions.JWK{{Kid: "jwk-1"}},
		},
		Expiry: time.Now().Add(24 * time.Hour),
	}

	if err := provider.SaveDefinitions(ctx, defs); err != nil {
		t.Fatalf("failed to save definitions: %v", err)
	}
	if err := provider.SaveJWKS(ctx, jwks); err != nil {
		t.Fatalf("failed to save JWKS: %v", err)
	}

	loadedDefs, err := provider.LoadDefinitions(ctx)
	if err != nil {
		t.Fatalf("failed to load definitions: %v", err)
	}
	loadedJWKS, err := provider.LoadJWKS(ctx)
	if err != nil {
		t.Fatalf("failed to load JWKS: %v", err)
	}

	if len(loadedDefs.Defs) != 2 {
		t.Errorf("expected 2 definitions, got %d", len(loadedDefs.Defs))
	}
	if len(loadedJWKS.Set.Keys) != 1 {
		t.Errorf("expected 1 key, got %d", len(loadedJWKS.Set.Keys))
	}
}
