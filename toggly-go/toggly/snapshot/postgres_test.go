package snapshot

import (
	"context"
	"database/sql"
	"os"
	"testing"
	"time"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/definitions"
	_ "github.com/lib/pq"
)

func getPostgresDB(t *testing.T) *sql.DB {
	t.Helper()
	connStr := os.Getenv("POSTGRES_TEST_URL")
	if connStr == "" {
		t.Skip("POSTGRES_TEST_URL not set, skipping PostgreSQL tests")
	}
	db, err := sql.Open("postgres", connStr)
	if err != nil {
		t.Fatalf("failed to open postgres: %v", err)
	}
	return db
}

func cleanupPostgresTable(t *testing.T, db *sql.DB, tableName string) {
	t.Helper()
	_, _ = db.Exec(`DROP TABLE IF EXISTS "` + tableName + `"`)
}

func TestPostgresProvider_LoadDefinitions_WhenEmpty(t *testing.T) {
	db := getPostgresDB(t)
	defer db.Close()

	tableName := "test_snapshots_empty"
	cleanupPostgresTable(t, db, tableName)
	defer cleanupPostgresTable(t, db, tableName)

	provider := NewPostgresProvider(PostgresOptions{
		DB:              db,
		TableName:       tableName,
		AutoCreateTable: true,
	})
	snap, err := provider.LoadDefinitions(context.Background())

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if snap != nil {
		t.Fatalf("expected nil snapshot, got %+v", snap)
	}
}

func TestPostgresProvider_SaveAndLoadDefinitions(t *testing.T) {
	db := getPostgresDB(t)
	defer db.Close()

	tableName := "test_snapshots_save_load"
	cleanupPostgresTable(t, db, tableName)
	defer cleanupPostgresTable(t, db, tableName)

	provider := NewPostgresProvider(PostgresOptions{
		DB:              db,
		TableName:       tableName,
		AutoCreateTable: true,
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

func TestPostgresProvider_SaveDefinitions_Updates(t *testing.T) {
	db := getPostgresDB(t)
	defer db.Close()

	tableName := "test_snapshots_update"
	cleanupPostgresTable(t, db, tableName)
	defer cleanupPostgresTable(t, db, tableName)

	provider := NewPostgresProvider(PostgresOptions{
		DB:              db,
		TableName:       tableName,
		AutoCreateTable: true,
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
}

func TestPostgresProvider_SaveAndLoadJWKS(t *testing.T) {
	db := getPostgresDB(t)
	defer db.Close()

	tableName := "test_snapshots_jwks"
	cleanupPostgresTable(t, db, tableName)
	defer cleanupPostgresTable(t, db, tableName)

	provider := NewPostgresProvider(PostgresOptions{
		DB:              db,
		TableName:       tableName,
		AutoCreateTable: true,
	})
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
}

func TestPostgresProvider_CustomOptions(t *testing.T) {
	db := getPostgresDB(t)
	defer db.Close()

	tableName := "custom_pg_snapshots"
	cleanupPostgresTable(t, db, tableName)
	defer cleanupPostgresTable(t, db, tableName)

	provider := NewPostgresProvider(PostgresOptions{
		DB:              db,
		TableName:       tableName,
		DefinitionsID:   "custom_defs",
		JWKSID:          "custom_jwks",
		AutoCreateTable: true,
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

	snap, err := provider.LoadDefinitions(ctx)
	if err != nil {
		t.Fatalf("failed to load with custom options: %v", err)
	}
	if snap.Defs[0].FeatureKey != "custom-feature" {
		t.Errorf("expected custom-feature, got %s", snap.Defs[0].FeatureKey)
	}
}

func TestPostgresProvider_DefaultOptions(t *testing.T) {
	db := getPostgresDB(t)
	defer db.Close()

	provider := NewPostgresProvider(PostgresOptions{DB: db})

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

func TestPostgresProvider_ImplementsInterface(t *testing.T) {
	db := getPostgresDB(t)
	defer db.Close()

	var _ Provider = NewPostgresProvider(PostgresOptions{DB: db})
}

func TestPostgresProvider_RoundTrip(t *testing.T) {
	db := getPostgresDB(t)
	defer db.Close()

	tableName := "test_snapshots_roundtrip"
	cleanupPostgresTable(t, db, tableName)
	defer cleanupPostgresTable(t, db, tableName)

	provider := NewPostgresProvider(PostgresOptions{
		DB:              db,
		TableName:       tableName,
		AutoCreateTable: true,
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

func TestNullString(t *testing.T) {
	tests := []struct {
		input    string
		expected bool
	}{
		{"", false},
		{"test", true},
	}

	for _, tt := range tests {
		result := nullString(tt.input)
		if result.Valid != tt.expected {
			t.Errorf("nullString(%q).Valid = %v, want %v", tt.input, result.Valid, tt.expected)
		}
		if tt.expected && result.String != tt.input {
			t.Errorf("nullString(%q).String = %v, want %v", tt.input, result.String, tt.input)
		}
	}
}

func TestNullInt64(t *testing.T) {
	tests := []struct {
		input    int64
		expected bool
	}{
		{0, false},
		{123, true},
		{-1, true},
	}

	for _, tt := range tests {
		result := nullInt64(tt.input)
		if result.Valid != tt.expected {
			t.Errorf("nullInt64(%d).Valid = %v, want %v", tt.input, result.Valid, tt.expected)
		}
		if tt.expected && result.Int64 != tt.input {
			t.Errorf("nullInt64(%d).Int64 = %v, want %v", tt.input, result.Int64, tt.input)
		}
	}
}
