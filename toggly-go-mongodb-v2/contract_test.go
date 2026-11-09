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

// contractDefinitions mirrors the Toggly /definitions API shape exercised by
// toggly-go's own filter and IsEnabled tests: AlwaysOn/Off, Percentage,
// Targeting, and UserClaims with RequirementAny/All.
func contractDefinitions() []definitions.FeatureDefinitionModel {
	return []definitions.FeatureDefinitionModel{
		{
			FeatureKey:      "always-on",
			Filters:         []definitions.FeatureFilter{{Name: "AlwaysOn"}},
			RequirementType: definitions.RequirementAny,
		},
		{
			FeatureKey:      "always-off",
			Filters:         []definitions.FeatureFilter{{Name: "AlwaysOff"}},
			RequirementType: definitions.RequirementAny,
		},
		{
			FeatureKey: "percentage-open",
			Filters: []definitions.FeatureFilter{{
				Name:       "Percentage",
				Parameters: map[string]any{"Value": float64(100)},
			}},
			RequirementType: definitions.RequirementAny,
		},
		{
			FeatureKey: "percentage-closed",
			Filters: []definitions.FeatureFilter{{
				Name:       "Percentage",
				Parameters: map[string]any{"Value": float64(0)},
			}},
			RequirementType: definitions.RequirementAny,
		},
		{
			FeatureKey: "targeting-alice",
			Filters: []definitions.FeatureFilter{{
				Name: "Targeting",
				Parameters: map[string]any{
					"Audience.Users:0":                  "alice",
					"Audience.DefaultRolloutPercentage": float64(0),
				},
			}},
			RequirementType: definitions.RequirementAny,
		},
		{
			FeatureKey: "claims-admin",
			Filters: []definitions.FeatureFilter{{
				Name: "UserClaims",
				Parameters: map[string]any{
					"Percentage": float64(100),
					"Claim":      "role",
					"Value":      "admin",
				},
			}},
			RequirementType: definitions.RequirementAny,
		},
		{
			FeatureKey: "all-filters",
			Filters: []definitions.FeatureFilter{
				{Name: "AlwaysOn"},
				{
					Name: "UserClaims",
					Parameters: map[string]any{
						"Percentage": float64(100),
						"Claim":      "role",
						"Value":      "admin",
					},
				},
			},
			RequirementType: definitions.RequirementAll,
		},
	}
}

func connectContractMongo(t *testing.T, collectionName string) (*mongo.Client, *mongo.Collection) {
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
	return client, collection
}

func TestMongoDBProvider_StoreLoadEvaluateContract(t *testing.T) {
	_, collection := connectContractMongo(t, "mongodb_v2_contract_eval")
	provider := NewMongoDBProvider(MongoDBOptions{Collection: collection})
	ctx := context.Background()

	defs := contractDefinitions()
	raw, err := json.Marshal(defs)
	if err != nil {
		t.Fatalf("marshal contract definitions: %v", err)
	}
	input := snapshot.DefinitionsSnapshot{
		Defs:      defs,
		Signature: "contract-signature",
		Kid:       "contract-kid",
		Timestamp: 1_700_000_100,
		RawDefs:   json.RawMessage(raw),
		ETag:      "contract-etag-1",
	}
	if err := provider.SaveDefinitions(ctx, input); err != nil {
		t.Fatalf("SaveDefinitions: %v", err)
	}

	loaded, err := provider.LoadDefinitions(ctx)
	if err != nil {
		t.Fatalf("LoadDefinitions: %v", err)
	}
	if loaded == nil {
		t.Fatal("LoadDefinitions returned nil snapshot")
	}
	if loaded.ETag != input.ETag || loaded.Signature != input.Signature || loaded.Kid != input.Kid || loaded.Timestamp != input.Timestamp {
		t.Fatalf("loaded metadata = %#v, want %#v", loaded, input)
	}
	if string(loaded.RawDefs) != string(input.RawDefs) {
		t.Fatalf("raw defs round-trip mismatch:\n got %s\nwant %s", loaded.RawDefs, input.RawDefs)
	}
	if len(loaded.Defs) != len(defs) {
		t.Fatalf("loaded %d defs, want %d", len(loaded.Defs), len(defs))
	}

	engine := eval.NewEngine(eval.DefaultRegistry())
	byKey := make(map[string]definitions.FeatureDefinitionModel, len(loaded.Defs))
	for _, def := range loaded.Defs {
		byKey[def.FeatureKey] = def
	}

	cases := []struct {
		key  string
		ctx  eval.Context
		want bool
	}{
		{key: "always-on", want: true},
		{key: "always-off", want: false},
		{key: "percentage-open", ctx: eval.Context{Identity: "user-1"}, want: true},
		{key: "percentage-closed", ctx: eval.Context{Identity: "user-1"}, want: false},
		{key: "targeting-alice", ctx: eval.Context{Identity: "alice"}, want: true},
		{key: "targeting-alice", ctx: eval.Context{Identity: "bob"}, want: false},
		{key: "claims-admin", ctx: eval.Context{Identity: "u", Claims: map[string]string{"role": "admin"}}, want: true},
		{key: "claims-admin", ctx: eval.Context{Identity: "u", Claims: map[string]string{"role": "user"}}, want: false},
		{key: "all-filters", ctx: eval.Context{Identity: "u", Claims: map[string]string{"role": "admin"}}, want: true},
		{key: "all-filters", ctx: eval.Context{Identity: "u", Claims: map[string]string{"role": "user"}}, want: false},
	}
	for _, tc := range cases {
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

func TestMongoDBProvider_ClientLoadsSnapshotAndEvaluates(t *testing.T) {
	_, collection := connectContractMongo(t, "mongodb_v2_contract_client")
	provider := NewMongoDBProvider(MongoDBOptions{Collection: collection})
	ctx := context.Background()

	defs := contractDefinitions()
	raw, err := json.Marshal(defs)
	if err != nil {
		t.Fatalf("marshal contract definitions: %v", err)
	}
	if err := provider.SaveDefinitions(ctx, snapshot.DefinitionsSnapshot{
		Defs:      defs,
		Signature: "client-contract-signature",
		Kid:       "client-contract-kid",
		Timestamp: 1_700_000_200,
		RawDefs:   json.RawMessage(raw),
		ETag:      "client-contract-etag",
	}); err != nil {
		t.Fatalf("SaveDefinitions: %v", err)
	}

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

	deadline := time.Now().Add(5 * time.Second)
	var enabled bool
	for {
		enabled, err = client.IsEnabled(ctx, "always-on", toggly.Context{Identity: "contract-user"})
		if err == nil && enabled {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("client never loaded MongoDB snapshot: IsEnabled(always-on)=%v, err=%v", enabled, err)
		}
		time.Sleep(25 * time.Millisecond)
	}

	assertClientFlag := func(key string, evalCtx toggly.Context, want bool) {
		t.Helper()
		got, err := client.IsEnabled(ctx, key, evalCtx)
		if err != nil {
			t.Fatalf("IsEnabled(%q): %v", key, err)
		}
		if got != want {
			t.Errorf("IsEnabled(%q) = %v, want %v", key, got, want)
		}
	}

	assertClientFlag("always-on", toggly.Context{}, true)
	assertClientFlag("always-off", toggly.Context{}, false)
	assertClientFlag("percentage-open", toggly.Context{Identity: "user-1"}, true)
	assertClientFlag("percentage-closed", toggly.Context{Identity: "user-1"}, false)
	assertClientFlag("targeting-alice", toggly.Context{Identity: "alice"}, true)
	assertClientFlag("targeting-alice", toggly.Context{Identity: "bob"}, false)
	assertClientFlag("claims-admin", toggly.Context{Identity: "u", Claims: map[string]string{"role": "admin"}}, true)
	assertClientFlag("claims-admin", toggly.Context{Identity: "u", Claims: map[string]string{"role": "user"}}, false)
	assertClientFlag("all-filters", toggly.Context{Identity: "u", Claims: map[string]string{"role": "admin"}}, true)
	assertClientFlag("all-filters", toggly.Context{Identity: "u", Claims: map[string]string{"role": "user"}}, false)
}
