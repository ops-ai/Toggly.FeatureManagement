package mongodbv2

import (
	"context"
	"encoding/json"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/definitions"
	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/snapshot"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

func TestNewMongoDBProvider_DefaultIdentifiers(t *testing.T) {
	provider := NewMongoDBProvider(MongoDBOptions{})

	if provider.definitionsID != "toggly_definitions" {
		t.Fatalf("definitions ID = %q, want toggly_definitions", provider.definitionsID)
	}
	if provider.jwksID != "toggly_jwks" {
		t.Fatalf("JWKS ID = %q, want toggly_jwks", provider.jwksID)
	}
}

func TestNewMongoDBProvider_CustomIdentifiers(t *testing.T) {
	provider := NewMongoDBProvider(MongoDBOptions{
		DefinitionsID: "definitions-v2",
		JWKSID:        "jwks-v2",
	})

	if provider.definitionsID != "definitions-v2" {
		t.Fatalf("definitions ID = %q, want definitions-v2", provider.definitionsID)
	}
	if provider.jwksID != "jwks-v2" {
		t.Fatalf("JWKS ID = %q, want jwks-v2", provider.jwksID)
	}
}

func TestDefinitionsDocument_RoundTripsRetainedV1Layout(t *testing.T) {
	input := snapshot.DefinitionsSnapshot{
		Defs: []definitions.FeatureDefinitionModel{{
			FeatureKey: "checkout",
			Filters:    []definitions.FeatureFilter{{Name: "AlwaysOn"}},
		}},
		Signature: "signature",
		Kid:       "kid-1",
		Timestamp: 1_700_000_000,
		RawDefs:   json.RawMessage(`[{"featureKey":"checkout"}]`),
		ETag:      "definition-revision",
	}

	document, err := definitionsDocument("toggly_definitions", input)
	if err != nil {
		t.Fatalf("definitionsDocument() error = %v", err)
	}

	encoded, err := bson.Marshal(document)
	if err != nil {
		t.Fatalf("marshal document: %v", err)
	}
	var persisted bson.M
	if err := bson.Unmarshal(encoded, &persisted); err != nil {
		t.Fatalf("unmarshal document: %v", err)
	}

	for _, field := range []string{"_id", "data", "signature", "kid", "timestamp", "rawDefs", "etag", "updatedAt"} {
		if _, ok := persisted[field]; !ok {
			t.Errorf("persisted document omits retained v1 field %q", field)
		}
	}
	if document.ID != "toggly_definitions" || document.Data == "" {
		t.Fatalf("document identity/data = %#v, want retained definitions document", document)
	}

	loaded, err := definitionsSnapshot(document)
	if err != nil {
		t.Fatalf("definitionsSnapshot() error = %v", err)
	}
	if !reflect.DeepEqual(loaded.Defs, input.Defs) {
		t.Errorf("definitions = %#v, want %#v", loaded.Defs, input.Defs)
	}
	if loaded.Signature != input.Signature || loaded.Kid != input.Kid || loaded.Timestamp != input.Timestamp || loaded.ETag != input.ETag {
		t.Errorf("loaded metadata = %#v, want %#v", loaded, input)
	}
	if string(loaded.RawDefs) != string(input.RawDefs) {
		t.Errorf("raw definitions = %s, want %s", loaded.RawDefs, input.RawDefs)
	}
}

func TestDefinitionsSnapshot_LoadsRetainedV1DocumentFixture(t *testing.T) {
	// This fixture is the BSON field layout emitted by the retained Driver v1
	// adapter. Keep it independent of the new provider's document constructor
	// so a v2-only implementation cannot accidentally alter the migration path.
	legacy := mongoDocument{
		ID:        "toggly_definitions",
		Data:      `[{"featureKey":"checkout","filters":[{"name":"AlwaysOn"}]}]`,
		Signature: "v1-signature",
		Kid:       "v1-kid",
		Timestamp: 1_700_000_000,
		RawDefs:   `[{"featureKey":"checkout"}]`,
		ETag:      "v1-revision",
		UpdatedAt: time.Date(2026, time.September, 1, 0, 0, 0, 0, time.UTC),
	}
	encoded, err := bson.Marshal(legacy)
	if err != nil {
		t.Fatalf("marshal retained fixture: %v", err)
	}
	var stored mongoDocument
	if err := bson.Unmarshal(encoded, &stored); err != nil {
		t.Fatalf("unmarshal retained fixture: %v", err)
	}

	loaded, err := definitionsSnapshot(stored)
	if err != nil {
		t.Fatalf("definitionsSnapshot() error = %v", err)
	}
	if loaded == nil || loaded.Signature != "v1-signature" || loaded.Kid != "v1-kid" || loaded.ETag != "v1-revision" {
		t.Fatalf("loaded retained snapshot = %#v", loaded)
	}
	if string(loaded.RawDefs) != legacy.RawDefs || len(loaded.Defs) != 1 || loaded.Defs[0].FeatureKey != "checkout" {
		t.Fatalf("loaded retained definitions = %#v", loaded)
	}
}

func TestDefinitionsSnapshot_EmptyOrMalformedDocument(t *testing.T) {
	empty, err := definitionsSnapshot(mongoDocument{})
	if err != nil {
		t.Fatalf("empty document error = %v", err)
	}
	if empty != nil {
		t.Fatalf("empty document snapshot = %#v, want nil", empty)
	}

	if _, err := definitionsSnapshot(mongoDocument{Data: "not-json"}); err == nil {
		t.Fatal("malformed data did not return an error")
	}
}

func TestJWKS_DocumentRoundTripUsesRetainedLayout(t *testing.T) {
	expiry := time.Date(2026, time.September, 12, 10, 0, 0, 0, time.UTC)
	input := snapshot.JWKSnap{
		Set: definitions.JWKSet{Keys: []definitions.JWK{{
			Kid: "kid-1",
			Kty: "EC",
			Crv: "P-256",
			X:   "x-coordinate",
			Y:   "y-coordinate",
		}}},
		Expiry: expiry,
	}

	document, err := jwksDocument("toggly_jwks", input)
	if err != nil {
		t.Fatalf("jwksDocument() error = %v", err)
	}
	if document.ID != "toggly_jwks" || document.Expiry != expiry.Unix() {
		t.Fatalf("document = %#v, want retained v1 JWKS layout", document)
	}

	loaded, err := jwksSnapshot(document)
	if err != nil {
		t.Fatalf("jwksSnapshot() error = %v", err)
	}
	if !reflect.DeepEqual(loaded.Set, input.Set) || !loaded.Expiry.Equal(expiry) {
		t.Errorf("loaded JWKS = %#v, want %#v", loaded, input)
	}
}

func TestJWKS_SnapshotEmptyOrMalformedDocument(t *testing.T) {
	empty, err := jwksSnapshot(mongoDocument{})
	if err != nil {
		t.Fatalf("empty document error = %v", err)
	}
	if empty != nil {
		t.Fatalf("empty document snapshot = %#v, want nil", empty)
	}

	if _, err := jwksSnapshot(mongoDocument{Data: "not-json"}); err == nil {
		t.Fatal("malformed data did not return an error")
	}
}

func TestMongoDBProvider_DriverV2Integration(t *testing.T) {
	uri := os.Getenv("MONGO_TEST_URI")
	if uri == "" {
		t.Skip("MONGO_TEST_URI not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	client, err := mongo.Connect(options.Client().ApplyURI(uri))
	if err != nil {
		t.Fatalf("connect MongoDB Driver v2: %v", err)
	}
	defer func() { _ = client.Disconnect(ctx) }()

	collection := client.Database("toggly_tests").Collection("mongodb_v2_snapshot")
	if err := collection.Drop(ctx); err != nil {
		t.Fatalf("drop test collection: %v", err)
	}
	defer func() { _ = collection.Drop(context.Background()) }()

	provider := NewMongoDBProvider(MongoDBOptions{Collection: collection})
	definitionsInput := snapshot.DefinitionsSnapshot{
		Defs:      []definitions.FeatureDefinitionModel{{FeatureKey: "checkout"}},
		Signature: "signature",
		Kid:       "kid-1",
		Timestamp: 1_700_000_000,
		RawDefs:   json.RawMessage(`[{"featureKey":"checkout"}]`),
		ETag:      "revision-1",
	}
	if err := provider.SaveDefinitions(ctx, definitionsInput); err != nil {
		t.Fatalf("save definitions: %v", err)
	}
	definitionsOutput, err := provider.LoadDefinitions(ctx)
	if err != nil {
		t.Fatalf("load definitions: %v", err)
	}
	if definitionsOutput == nil || definitionsOutput.ETag != definitionsInput.ETag || string(definitionsOutput.RawDefs) != string(definitionsInput.RawDefs) {
		t.Fatalf("loaded definitions = %#v, want persisted signed snapshot", definitionsOutput)
	}

	jwksInput := snapshot.JWKSnap{Set: definitions.JWKSet{Keys: []definitions.JWK{{Kid: "kid-1"}}}, Expiry: time.Now().UTC().Add(time.Hour).Truncate(time.Second)}
	if err := provider.SaveJWKS(ctx, jwksInput); err != nil {
		t.Fatalf("save JWKS: %v", err)
	}
	jwksOutput, err := provider.LoadJWKS(ctx)
	if err != nil {
		t.Fatalf("load JWKS: %v", err)
	}
	if jwksOutput == nil || !reflect.DeepEqual(jwksOutput.Set, jwksInput.Set) || !jwksOutput.Expiry.Equal(jwksInput.Expiry) {
		t.Fatalf("loaded JWKS = %#v, want %#v", jwksOutput, jwksInput)
	}

	if err := provider.Clear(ctx); err != nil {
		t.Fatalf("clear snapshots: %v", err)
	}
	definitionsOutput, err = provider.LoadDefinitions(ctx)
	if err != nil || definitionsOutput != nil {
		t.Fatalf("definitions after clear = %#v, %v; want nil, nil", definitionsOutput, err)
	}
}

var _ snapshot.Provider = (*MongoDBProvider)(nil)
