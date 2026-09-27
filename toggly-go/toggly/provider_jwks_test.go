package toggly

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/definitions"
	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/snapshot"
)

func TestProviderJWKSFetchCachesAndPersists(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.URL.Path != "/.well-known/jwks" {
			t.Errorf("JWKS path = %q", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"keys":[{"kid":"current","kty":"EC"}]}`))
	}))
	defer server.Close()
	store := snapshot.NewMemoryProvider()
	provider := newDefinitionsProvider(Config{AppKey: "app", DefinitionsURL: server.URL + "/"}, store)
	for range 2 {
		keys, err := provider.loadOrFetchJWKS(context.Background())
		if err != nil || len(keys.Keys) != 1 || keys.Keys[0].Kid != "current" {
			t.Fatalf("JWKS = %#v, %v", keys, err)
		}
	}
	if requests != 1 {
		t.Fatalf("JWKS fetches = %d, want 1 with in-memory cache", requests)
	}
	persisted, err := store.LoadJWKS(context.Background())
	if err != nil || persisted == nil || persisted.Set.Keys[0].Kid != "current" {
		t.Fatalf("persisted JWKS = %#v, %v", persisted, err)
	}

	second := newDefinitionsProvider(Config{AppKey: "app", DefinitionsURL: server.URL + "/"}, store)
	if _, err := second.loadOrFetchJWKS(context.Background()); err != nil || requests != 1 {
		t.Fatalf("snapshot cache load = %v, requests = %d", err, requests)
	}
}

func TestProviderJWKSRejectsBadResponsesAndExpiredSnapshots(t *testing.T) {
	for _, tc := range []struct {
		name string
		code int
		body string
		want string
	}{
		{"status", http.StatusBadGateway, "upstream failed", "jwks fetch failed"},
		{"malformed", http.StatusOK, "not-json", "decode jwks"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(tc.code)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer server.Close()
			store := snapshot.NewMemoryProvider()
			_ = store.SaveJWKS(context.Background(), snapshot.JWKSnap{
				Set:    definitions.JWKSet{Keys: []definitions.JWK{{Kid: "expired"}}},
				Expiry: time.Now().Add(-time.Minute),
			})
			provider := newDefinitionsProvider(Config{AppKey: "app", DefinitionsURL: server.URL + "/"}, store)
			if _, err := provider.loadOrFetchJWKS(context.Background()); err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("JWKS error = %v, want %q", err, tc.want)
			}
		})
	}
}

func TestProviderJWKSExpiryUsesEarliestKeyExpiry(t *testing.T) {
	soon := time.Now().Add(time.Hour).Unix()
	later := time.Now().Add(2 * time.Hour).Unix()
	expiry := computeJWKSExpiry([]definitions.JWK{{Kid: "later", Exp: &later}, {Kid: "soon", Exp: &soon}})
	if expiry.Unix() != soon {
		t.Fatalf("JWKS expiry = %v, want earliest key expiry %v", expiry, time.Unix(soon, 0))
	}
}
