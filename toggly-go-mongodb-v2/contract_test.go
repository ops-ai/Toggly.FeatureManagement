package mongodbv2

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly"
	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/definitions"
	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/eval"
	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/snapshot"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

const (
	flagAlwaysOn         = "always-on"
	flagAlwaysOff        = "always-off"
	flagPercentageOpen   = "percentage-open"
	flagPercentageClosed = "percentage-closed"
	flagTargetingAlice   = "targeting-alice"
	flagClaimsAdmin      = "claims-admin"
	flagAllFilters       = "all-filters"
	contractUserID       = "user-1"
	contractAliceID      = "alice"
	contractBobID        = "bob"
	contractGenericID    = "u"
	contractAdminRole    = "admin"
	contractUserRole     = "user"
	contractRoleClaim    = "role"
)

// contractDefinitions mirrors the Toggly /definitions API shape exercised by
// toggly-go's own filter and IsEnabled tests: AlwaysOn/Off, Percentage,
// Targeting, and UserClaims with RequirementAny/All.
func contractDefinitions() []definitions.FeatureDefinitionModel {
	adminClaimsFilter := definitions.FeatureFilter{
		Name: "UserClaims",
		Parameters: map[string]any{
			"Percentage": float64(100),
			"Claim":      contractRoleClaim,
			"Value":      contractAdminRole,
		},
	}
	return []definitions.FeatureDefinitionModel{
		{
			FeatureKey:      flagAlwaysOn,
			Filters:         []definitions.FeatureFilter{{Name: "AlwaysOn"}},
			RequirementType: definitions.RequirementAny,
		},
		{
			FeatureKey:      flagAlwaysOff,
			Filters:         []definitions.FeatureFilter{{Name: "AlwaysOff"}},
			RequirementType: definitions.RequirementAny,
		},
		{
			FeatureKey: flagPercentageOpen,
			Filters: []definitions.FeatureFilter{{
				Name:       "Percentage",
				Parameters: map[string]any{"Value": float64(100)},
			}},
			RequirementType: definitions.RequirementAny,
		},
		{
			FeatureKey: flagPercentageClosed,
			Filters: []definitions.FeatureFilter{{
				Name:       "Percentage",
				Parameters: map[string]any{"Value": float64(0)},
			}},
			RequirementType: definitions.RequirementAny,
		},
		{
			FeatureKey: flagTargetingAlice,
			Filters: []definitions.FeatureFilter{{
				Name: "Targeting",
				Parameters: map[string]any{
					"Audience.Users:0":                  contractAliceID,
					"Audience.DefaultRolloutPercentage": float64(0),
				},
			}},
			RequirementType: definitions.RequirementAny,
		},
		{
			FeatureKey:      flagClaimsAdmin,
			Filters:         []definitions.FeatureFilter{adminClaimsFilter},
			RequirementType: definitions.RequirementAny,
		},
		{
			FeatureKey: flagAllFilters,
			Filters: []definitions.FeatureFilter{
				{Name: "AlwaysOn"},
				adminClaimsFilter,
			},
			RequirementType: definitions.RequirementAll,
		},
	}
}

func connectContractMongo(t *testing.T, collectionName string) *mongo.Collection {
	t.Helper()
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
	t.Cleanup(func() {
		_ = client.Disconnect(context.Background())
	})

	collection := client.Database("toggly_tests").Collection(collectionName)
	if err := collection.Drop(ctx); err != nil {
		t.Fatalf("drop test collection: %v", err)
	}
	t.Cleanup(func() {
		_ = collection.Drop(context.Background())
	})
	return collection
}

func saveContractSnapshot(t *testing.T, provider *MongoDBProvider, snap snapshot.DefinitionsSnapshot) {
	t.Helper()
	if err := provider.SaveDefinitions(context.Background(), snap); err != nil {
		t.Fatalf("SaveDefinitions: %v", err)
	}
}

func mustMarshalDefs(t *testing.T, defs []definitions.FeatureDefinitionModel) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(defs)
	if err != nil {
		t.Fatalf("marshal contract definitions: %v", err)
	}
	return json.RawMessage(raw)
}

func loadContractSnapshot(t *testing.T, provider *MongoDBProvider, want snapshot.DefinitionsSnapshot) *snapshot.DefinitionsSnapshot {
	t.Helper()
	loaded, err := provider.LoadDefinitions(context.Background())
	if err != nil {
		t.Fatalf("LoadDefinitions: %v", err)
	}
	if loaded == nil {
		t.Fatal("LoadDefinitions returned nil snapshot")
	}
	if loaded.ETag != want.ETag || loaded.Signature != want.Signature || loaded.Kid != want.Kid || loaded.Timestamp != want.Timestamp {
		t.Fatalf("loaded metadata = %#v, want %#v", loaded, want)
	}
	if string(loaded.RawDefs) != string(want.RawDefs) {
		t.Fatalf("raw defs round-trip mismatch:\n got %s\nwant %s", loaded.RawDefs, want.RawDefs)
	}
	if len(loaded.Defs) != len(want.Defs) {
		t.Fatalf("loaded %d defs, want %d", len(loaded.Defs), len(want.Defs))
	}
	return loaded
}

func adminClaims(role string) map[string]string {
	return map[string]string{contractRoleClaim: role}
}

func contractEvalCases() []struct {
	key  string
	ctx  eval.Context
	want bool
} {
	return []struct {
		key  string
		ctx  eval.Context
		want bool
	}{
		{key: flagAlwaysOn, want: true},
		{key: flagAlwaysOff, want: false},
		{key: flagPercentageOpen, ctx: eval.Context{Identity: contractUserID}, want: true},
		{key: flagPercentageClosed, ctx: eval.Context{Identity: contractUserID}, want: false},
		{key: flagTargetingAlice, ctx: eval.Context{Identity: contractAliceID}, want: true},
		{key: flagTargetingAlice, ctx: eval.Context{Identity: contractBobID}, want: false},
		{key: flagClaimsAdmin, ctx: eval.Context{Identity: contractGenericID, Claims: adminClaims(contractAdminRole)}, want: true},
		{key: flagClaimsAdmin, ctx: eval.Context{Identity: contractGenericID, Claims: adminClaims(contractUserRole)}, want: false},
		{key: flagAllFilters, ctx: eval.Context{Identity: contractGenericID, Claims: adminClaims(contractAdminRole)}, want: true},
		{key: flagAllFilters, ctx: eval.Context{Identity: contractGenericID, Claims: adminClaims(contractUserRole)}, want: false},
	}
}

func assertEngineEvaluations(t *testing.T, defs []definitions.FeatureDefinitionModel) {
	t.Helper()
	engine := eval.NewEngine(eval.DefaultRegistry())
	byKey := make(map[string]definitions.FeatureDefinitionModel, len(defs))
	for _, def := range defs {
		byKey[def.FeatureKey] = def
	}
	for _, tc := range contractEvalCases() {
		def, ok := byKey[tc.key]
		if !ok {
			t.Fatalf("missing loaded definition %q", tc.key)
		}
		got, err := engine.Evaluate(def, tc.ctx)
		if err != nil {
			t.Fatalf("Evaluate(%q): %v", tc.key, err)
		}
		if got != tc.want {
			t.Errorf("Evaluate(%q) = %v, want %v", tc.key, got, tc.want)
		}
	}
}

func TestMongoDBProvider_StoreLoadEvaluateContract(t *testing.T) {
	collection := connectContractMongo(t, "mongodb_v2_contract_eval")
	provider := NewMongoDBProvider(MongoDBOptions{Collection: collection})

	defs := contractDefinitions()
	input := snapshot.DefinitionsSnapshot{
		Defs:      defs,
		Signature: "contract-signature",
		Kid:       "contract-kid",
		Timestamp: 1_700_000_100,
		RawDefs:   mustMarshalDefs(t, defs),
		ETag:      "contract-etag-1",
	}
	saveContractSnapshot(t, provider, input)
	loaded := loadContractSnapshot(t, provider, input)
	assertEngineEvaluations(t, loaded.Defs)
}

func waitForSnapshotFlag(t *testing.T, client *toggly.Client) {
	t.Helper()
	ctx := context.Background()
	deadline := time.Now().Add(5 * time.Second)
	for {
		enabled, err := client.IsEnabled(ctx, flagAlwaysOn, toggly.Context{Identity: "contract-user"})
		if err == nil && enabled {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("client never loaded MongoDB snapshot: IsEnabled(%s)=%v, err=%v", flagAlwaysOn, enabled, err)
		}
		time.Sleep(25 * time.Millisecond)
	}
}

func assertClientEvaluations(t *testing.T, client *toggly.Client) {
	t.Helper()
	ctx := context.Background()
	cases := []struct {
		key  string
		ctx  toggly.Context
		want bool
	}{
		{key: flagAlwaysOn, want: true},
		{key: flagAlwaysOff, want: false},
		{key: flagPercentageOpen, ctx: toggly.Context{Identity: contractUserID}, want: true},
		{key: flagPercentageClosed, ctx: toggly.Context{Identity: contractUserID}, want: false},
		{key: flagTargetingAlice, ctx: toggly.Context{Identity: contractAliceID}, want: true},
		{key: flagTargetingAlice, ctx: toggly.Context{Identity: contractBobID}, want: false},
		{key: flagClaimsAdmin, ctx: toggly.Context{Identity: contractGenericID, Claims: adminClaims(contractAdminRole)}, want: true},
		{key: flagClaimsAdmin, ctx: toggly.Context{Identity: contractGenericID, Claims: adminClaims(contractUserRole)}, want: false},
		{key: flagAllFilters, ctx: toggly.Context{Identity: contractGenericID, Claims: adminClaims(contractAdminRole)}, want: true},
		{key: flagAllFilters, ctx: toggly.Context{Identity: contractGenericID, Claims: adminClaims(contractUserRole)}, want: false},
	}
	for _, tc := range cases {
		got, err := client.IsEnabled(ctx, tc.key, tc.ctx)
		if err != nil {
			t.Fatalf("IsEnabled(%q): %v", tc.key, err)
		}
		if got != tc.want {
			t.Errorf("IsEnabled(%q) = %v, want %v", tc.key, got, tc.want)
		}
	}
}

func TestMongoDBProvider_ClientLoadsSnapshotAndEvaluates(t *testing.T) {
	collection := connectContractMongo(t, "mongodb_v2_contract_client")
	provider := NewMongoDBProvider(MongoDBOptions{Collection: collection})

	defs := contractDefinitions()
	saveContractSnapshot(t, provider, snapshot.DefinitionsSnapshot{
		Defs:      defs,
		Signature: "client-contract-signature",
		Kid:       "client-contract-kid",
		Timestamp: 1_700_000_200,
		RawDefs:   mustMarshalDefs(t, defs),
		ETag:      "client-contract-etag",
	})

	// Definitions endpoint stays down so the client must promote the MongoDB
	// snapshot into its in-memory catalog (startup durable path).
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "definitions unavailable", http.StatusServiceUnavailable)
	}))
	t.Cleanup(server.Close)

	client, err := toggly.NewClient(toggly.Config{
		AppKey:                           "contract-app",
		Environment:                      "Production",
		BaseURL:                          server.URL + "/",
		DefinitionsURL:                   server.URL + "/",
		SnapshotProvider:                 provider,
		HTTPTimeout:                      500 * time.Millisecond,
		RefreshInterval:                  time.Hour,
		DisableEntityContextRegistration: true,
		EnableLiveUpdates:                false,
	})
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	t.Cleanup(func() { _ = client.Close() })

	waitForSnapshotFlag(t, client)
	assertClientEvaluations(t, client)
}
