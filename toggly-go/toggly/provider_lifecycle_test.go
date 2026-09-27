package toggly

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/definitions"
)

func TestBackgroundRefreshLoadsDefinitionsAndStopsOnClose(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/definitions/app/Production" {
			t.Errorf("refresh path = %q", r.URL.Path)
		}
		calls.Add(1)
		_, _ = w.Write([]byte(`[{"featureKey":"checkout","filters":[{"name":"AlwaysOn"}]}]`))
	}))
	defer server.Close()
	client, err := NewClient(Config{
		AppKey: "app", DefinitionsURL: server.URL + "/",
		RefreshInterval:                  20 * time.Millisecond,
		DisableEntityContextRegistration: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for calls.Load() < 2 {
		if time.Now().After(deadline) {
			t.Fatalf("only %d background refreshes", calls.Load())
		}
		time.Sleep(5 * time.Millisecond)
	}
	if got, err := client.IsEnabled(context.Background(), "checkout", Context{}); err != nil || !got {
		t.Fatalf("refreshed feature = %t, %v", got, err)
	}
	if err := client.Close(); err != nil {
		t.Fatal(err)
	}
	countAfterClose := calls.Load()
	time.Sleep(45 * time.Millisecond)
	if calls.Load() != countAfterClose {
		t.Fatalf("background refresh continued after Close: %d -> %d", countAfterClose, calls.Load())
	}
}

func TestProviderRevisionAndSnapshotVerificationGuards(t *testing.T) {
	p := newDefinitionsProvider(Config{AppKey: "app", UseSignedDefinitions: true}, nil)
	if p.getDefinitionsRevision() != "" || p.isSecure("checkout") {
		t.Fatal("new provider had revision or secure flags")
	}
	p.applyDefinitions([]definitions.FeatureDefinitionModel{{FeatureKey: "checkout"}})
	p.mu.Lock()
	p.etag = "rev-1"
	p.mu.Unlock()
	if p.getDefinitionsRevision() != "rev-1" {
		t.Fatal("revision was not retained")
	}
	p.clearJWKS()
	if p.getDefinitionsRevision() != "" {
		t.Fatal("clearJWKS did not invalidate revision")
	}
	if err := p.verifySnapshotRawDefs(context.Background(), nil, "", "", 0); err == nil {
		t.Fatal("unsigned snapshot accepted")
	}
	if err := p.verifySnapshotRawDefs(context.Background(), nil, "sig", "kid", 1); err != nil {
		t.Fatalf("legacy snapshot without RawDefs was rejected: %v", err)
	}
}
