package snapshot

import (
	"context"
	"database/sql"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/definitions"
)

func newTestSQLiteDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("failed to open sqlite: %v", err)
	}
	return db
}

func TestSQLiteProvider_LoadDefinitions_WhenEmpty(t *testing.T) {
	db := newTestSQLiteDB(t)
	defer db.Close()

	provider := NewSQLiteProvider(SQLiteOptions{DB: db})
	snap, err := provider.LoadDefinitions(context.Background())

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if snap != nil {
		t.Fatalf("expected nil snapshot, got %+v", snap)
	}
}

func TestSQLiteProvider_SaveAndLoadDefinitions(t *testing.T) {
	db := newTestSQLiteDB(t)
	defer db.Close()

	provider := NewSQLiteProvider(SQLiteOptions{DB: db})
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
	if snap.Defs[1].FeatureKey != "feature2" {
		t.Errorf("expected feature2, got %s", snap.Defs[1].FeatureKey)
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

func TestSQLiteProvider_SaveDefinitions_Updates(t *testing.T) {
	db := newTestSQLiteDB(t)
	defer db.Close()

	provider := NewSQLiteProvider(SQLiteOptions{DB: db})
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
}

func TestSQLiteProvider_LoadJWKS_WhenEmpty(t *testing.T) {
	db := newTestSQLiteDB(t)
	defer db.Close()

	provider := NewSQLiteProvider(SQLiteOptions{DB: db})
	snap, err := provider.LoadJWKS(context.Background())

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if snap != nil {
		t.Fatalf("expected nil snapshot, got %+v", snap)
	}
}

func TestSQLiteProvider_SaveAndLoadJWKS(t *testing.T) {
	db := newTestSQLiteDB(t)
	defer db.Close()

	provider := NewSQLiteProvider(SQLiteOptions{DB: db})
	ctx := context.Background()

	expiry := time.Now().Add(24 * time.Hour)
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
	// Check expiry (compare Unix timestamps to avoid precision issues)
	if snap.Expiry.Unix() != expiry.Unix() {
		t.Errorf("expected expiry %v, got %v", expiry.Unix(), snap.Expiry.Unix())
	}
}

func TestSQLiteProvider_SaveJWKS_Updates(t *testing.T) {
	db := newTestSQLiteDB(t)
	defer db.Close()

	provider := NewSQLiteProvider(SQLiteOptions{DB: db})
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

func TestSQLiteProvider_CustomOptions(t *testing.T) {
	db := newTestSQLiteDB(t)
	defer db.Close()

	provider := NewSQLiteProvider(SQLiteOptions{
		DB:              db,
		TableName:       "custom_snapshots",
		DefinitionsID:   "custom_defs",
		JWKSID:          "custom_jwks",
		AutoCreateTable: true,
	})
	ctx := context.Background()

	// Verify it works with custom options
	input := DefinitionsSnapshot{
		Defs: []definitions.FeatureDefinitionModel{
			{FeatureKey: "custom-feature"},
		},
	}
	if err := provider.SaveDefinitions(ctx, input); err != nil {
		t.Fatalf("failed to save with custom options: %v", err)
	}

	snap, err := provider.LoadDefinitions(ctx)
	if err != nil {
		t.Fatalf("failed to load with custom options: %v", err)
	}
	if snap.Defs[0].FeatureKey != "custom-feature" {
		t.Errorf("expected custom-feature, got %s", snap.Defs[0].FeatureKey)
	}
}

func TestSQLiteProvider_DefaultOptions(t *testing.T) {
	db := newTestSQLiteDB(t)
	defer db.Close()

	provider := NewSQLiteProvider(SQLiteOptions{DB: db})

	// Verify defaults are set
	if provider.tableName != "toggly_snapshots" {
		t.Errorf("expected default table name toggly_snapshots, got %s", provider.tableName)
	}
	if provider.definitionsID != "toggly_definitions" {
		t.Errorf("expected default definitions ID toggly_definitions, got %s", provider.definitionsID)
	}
	if provider.jwksID != "toggly_jwks" {
		t.Errorf("expected default JWKS ID toggly_jwks, got %s", provider.jwksID)
	}
}

func TestSQLiteProvider_ImplementsInterface(t *testing.T) {
	db := newTestSQLiteDB(t)
	defer db.Close()

	var _ Provider = NewSQLiteProvider(SQLiteOptions{DB: db})
}

func TestSQLiteProvider_RoundTrip(t *testing.T) {
	db := newTestSQLiteDB(t)
	defer db.Close()

	provider := NewSQLiteProvider(SQLiteOptions{DB: db})
	ctx := context.Background()

	// Save both definitions and JWKS
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

	// Load both and verify
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

func TestSQLiteProvider_EmptyDefinitions(t *testing.T) {
	db := newTestSQLiteDB(t)
	defer db.Close()

	provider := NewSQLiteProvider(SQLiteOptions{DB: db})
	ctx := context.Background()

	// Save empty definitions
	input := DefinitionsSnapshot{
		Defs: []definitions.FeatureDefinitionModel{},
	}
	if err := provider.SaveDefinitions(ctx, input); err != nil {
		t.Fatalf("failed to save empty definitions: %v", err)
	}

	// Load and verify
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

func TestSQLiteProvider_ComplexFilters(t *testing.T) {
	db := newTestSQLiteDB(t)
	defer db.Close()

	provider := NewSQLiteProvider(SQLiteOptions{DB: db})
	ctx := context.Background()

	input := DefinitionsSnapshot{
		Defs: []definitions.FeatureDefinitionModel{
			{
				FeatureKey: "complex-feature",
				Filters: []definitions.FeatureFilter{
					{
						Name: "Percentage",
						Parameters: map[string]any{
							"Value": "25",
						},
					},
					{
						Name: "UserGroup",
						Parameters: map[string]any{
							"Groups": "beta,alpha",
						},
					},
				},
			},
		},
	}

	if err := provider.SaveDefinitions(ctx, input); err != nil {
		t.Fatalf("failed to save: %v", err)
	}

	snap, err := provider.LoadDefinitions(ctx)
	if err != nil {
		t.Fatalf("failed to load: %v", err)
	}

	if len(snap.Defs[0].Filters) != 2 {
		t.Fatalf("expected 2 filters, got %d", len(snap.Defs[0].Filters))
	}
	if snap.Defs[0].Filters[0].Parameters["Value"] != "25" {
		t.Errorf("expected Value=25, got %s", snap.Defs[0].Filters[0].Parameters["Value"])
	}
}
