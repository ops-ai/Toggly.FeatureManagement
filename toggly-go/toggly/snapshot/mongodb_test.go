package snapshot

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/definitions"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func getMongoCollection(t *testing.T, collectionName string) *mongo.Collection {
	t.Helper()
	uri := os.Getenv("MONGO_TEST_URI")
	if uri == "" {
		t.Skip("MONGO_TEST_URI not set, skipping MongoDB tests")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	client, err := mongo.Connect(ctx, options.Client().ApplyURI(uri))
	if err != nil {
		t.Fatalf("failed to connect to MongoDB: %v", err)
	}

	if err := client.Ping(ctx, nil); err != nil {
		t.Skipf("cannot ping MongoDB at %s: %v", uri, err)
	}

	return client.Database("toggly_tests").Collection(collectionName)
}

func cleanupMongoCollection(t *testing.T, collection *mongo.Collection) {
	t.Helper()
	ctx := context.Background()
	_ = collection.Drop(ctx)
}

func TestMongoDBProvider_LoadDefinitions_WhenEmpty(t *testing.T) {
	collection := getMongoCollection(t, "test_empty")
	cleanupMongoCollection(t, collection)
	defer cleanupMongoCollection(t, collection)

	provider := NewMongoDBProvider(MongoDBOptions{
		Collection: collection,
	})
	snap, err := provider.LoadDefinitions(context.Background())

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if snap != nil {
		t.Fatalf("expected nil snapshot, got %+v", snap)
	}
}

func TestMongoDBProvider_SaveAndLoadDefinitions(t *testing.T) {
	collection := getMongoCollection(t, "test_save_load")
	cleanupMongoCollection(t, collection)
	defer cleanupMongoCollection(t, collection)

	provider := NewMongoDBProvider(MongoDBOptions{
		Collection: collection,
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

func TestMongoDBProvider_SaveDefinitions_Updates(t *testing.T) {
	collection := getMongoCollection(t, "test_update")
	cleanupMongoCollection(t, collection)
	defer cleanupMongoCollection(t, collection)

	provider := NewMongoDBProvider(MongoDBOptions{
		Collection: collection,
	})
	ctx := context.Background()

	// Save first version
	input1 := DefinitionsSnapshot{
		Defs: []definitions.FeatureDefinitionModel{
			{FeatureKey: "feature1"},
		},
		Signature: "sig-1",
		Kid:       "kid-1",
		Timestamp: 1700000001,
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
		Kid:       "kid-2",
		Timestamp: 1700000002,
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

	// Verify only one document exists
	count, err := collection.CountDocuments(ctx, map[string]interface{}{"_id": "toggly_definitions"})
	if err != nil {
		t.Fatalf("failed to count documents: %v", err)
	}
	if count != 1 {
		t.Errorf("expected 1 document, got %d", count)
	}
}

func TestMongoDBProvider_LoadJWKS_WhenEmpty(t *testing.T) {
	collection := getMongoCollection(t, "test_jwks_empty")
	cleanupMongoCollection(t, collection)
	defer cleanupMongoCollection(t, collection)

	provider := NewMongoDBProvider(MongoDBOptions{
		Collection: collection,
	})
	snap, err := provider.LoadJWKS(context.Background())

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if snap != nil {
		t.Fatalf("expected nil snapshot, got %+v", snap)
	}
}

func TestMongoDBProvider_SaveAndLoadJWKS(t *testing.T) {
	collection := getMongoCollection(t, "test_jwks")
	cleanupMongoCollection(t, collection)
	defer cleanupMongoCollection(t, collection)

	provider := NewMongoDBProvider(MongoDBOptions{
		Collection: collection,
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
	if snap.Expiry.Unix() != expiry.Unix() {
		t.Errorf("expected expiry %v, got %v", expiry.Unix(), snap.Expiry.Unix())
	}
}

func TestMongoDBProvider_SaveJWKS_Updates(t *testing.T) {
	collection := getMongoCollection(t, "test_jwks_update")
	cleanupMongoCollection(t, collection)
	defer cleanupMongoCollection(t, collection)

	provider := NewMongoDBProvider(MongoDBOptions{
		Collection: collection,
	})
	ctx := context.Background()

	// Save first version
	input1 := JWKSnap{
		Set: definitions.JWKSet{
			Keys: []definitions.JWK{{Kid: "key-1"}},
		},
		Expiry: time.Now().Add(1 * time.Hour),
	}
	if err := provider.SaveJWKS(ctx, input1); err != nil {
		t.Fatalf("failed to save first version: %v", err)
	}

	// Save second version (update)
	newExpiry := time.Now().Add(48 * time.Hour)
	input2 := JWKSnap{
		Set: definitions.JWKSet{
			Keys: []definitions.JWK{{Kid: "key-2"}},
		},
		Expiry: newExpiry,
	}
	if err := provider.SaveJWKS(ctx, input2); err != nil {
		t.Fatalf("failed to save second version: %v", err)
	}

	// Load and verify
	snap, err := provider.LoadJWKS(ctx)
	if err != nil {
		t.Fatalf("failed to load JWKS: %v", err)
	}

	if snap.Set.Keys[0].Kid != "key-2" {
		t.Errorf("expected key-2, got %s", snap.Set.Keys[0].Kid)
	}
}

func TestMongoDBProvider_CustomOptions(t *testing.T) {
	collection := getMongoCollection(t, "test_custom_options")
	cleanupMongoCollection(t, collection)
	defer cleanupMongoCollection(t, collection)

	provider := NewMongoDBProvider(MongoDBOptions{
		Collection:    collection,
		DefinitionsID: "custom_defs",
		JWKSID:        "custom_jwks",
	})
	ctx := context.Background()

	input := DefinitionsSnapshot{
		Defs: []definitions.FeatureDefinitionModel{
			{FeatureKey: "custom-feature"},
		},
	}
	if err := provider.SaveDefinitions(ctx, input); err != nil {
		t.Fatalf("failed to save with custom options: %v", err)
	}

	// Verify document was saved with custom ID
	count, err := collection.CountDocuments(ctx, map[string]interface{}{"_id": "custom_defs"})
	if err != nil {
		t.Fatalf("failed to count documents: %v", err)
	}
	if count != 1 {
		t.Errorf("expected 1 document with custom ID, got %d", count)
	}

	snap, err := provider.LoadDefinitions(ctx)
	if err != nil {
		t.Fatalf("failed to load with custom options: %v", err)
	}
	if snap.Defs[0].FeatureKey != "custom-feature" {
		t.Errorf("expected custom-feature, got %s", snap.Defs[0].FeatureKey)
	}
}

func TestMongoDBProvider_DefaultOptions(t *testing.T) {
	collection := getMongoCollection(t, "test_default_options")
	cleanupMongoCollection(t, collection)
	defer cleanupMongoCollection(t, collection)

	provider := NewMongoDBProvider(MongoDBOptions{
		Collection: collection,
	})

	if provider.definitionsID != "toggly_definitions" {
		t.Errorf("expected default definitions ID toggly_definitions, got %s", provider.definitionsID)
	}
	if provider.jwksID != "toggly_jwks" {
		t.Errorf("expected default JWKS ID toggly_jwks, got %s", provider.jwksID)
	}
}

func TestMongoDBProvider_ImplementsInterface(t *testing.T) {
	collection := getMongoCollection(t, "test_interface")
	cleanupMongoCollection(t, collection)
	defer cleanupMongoCollection(t, collection)

	var _ Provider = NewMongoDBProvider(MongoDBOptions{Collection: collection})
}

func TestMongoDBProvider_RoundTrip(t *testing.T) {
	collection := getMongoCollection(t, "test_roundtrip")
	cleanupMongoCollection(t, collection)
	defer cleanupMongoCollection(t, collection)

	provider := NewMongoDBProvider(MongoDBOptions{
		Collection: collection,
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

	// Verify both documents exist
	count, err := collection.CountDocuments(ctx, map[string]interface{}{})
	if err != nil {
		t.Fatalf("failed to count documents: %v", err)
	}
	if count != 2 {
		t.Errorf("expected 2 documents, got %d", count)
	}
}

func TestMongoDBProvider_EmptyDefinitions(t *testing.T) {
	collection := getMongoCollection(t, "test_empty_defs")
	cleanupMongoCollection(t, collection)
	defer cleanupMongoCollection(t, collection)

	provider := NewMongoDBProvider(MongoDBOptions{
		Collection: collection,
	})
	ctx := context.Background()

	input := DefinitionsSnapshot{
		Defs: []definitions.FeatureDefinitionModel{},
	}
	if err := provider.SaveDefinitions(ctx, input); err != nil {
		t.Fatalf("failed to save empty definitions: %v", err)
	}

	snap, err := provider.LoadDefinitions(ctx)
	if err != nil {
		t.Fatalf("failed to load definitions: %v", err)
	}
	if snap == nil {
		t.Fatal("expected non-nil snapshot")
	}
	if len(snap.Defs) != 0 {
		t.Errorf("expected 0 definitions, got %d", len(snap.Defs))
	}
}
