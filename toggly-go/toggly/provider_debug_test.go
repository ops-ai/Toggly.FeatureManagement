package toggly

import (
	"testing"
	"time"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/definitions"
)

type testCloser struct{}

func (testCloser) Close() error { return nil }

func TestProviderDebugInfoReportsCurrentProviderState(t *testing.T) {
	var nilClient *Client
	if info := nilClient.ProviderDebugInfo(); info.DefinitionsCount != 0 || info.LiveUpdatesRunning {
		t.Fatalf("nil client debug info = %+v", info)
	}
	client, err := NewClient(Config{AppKey: "app", Environment: "Staging", EnableLiveUpdates: true, DisableBackgroundRefresh: true, DisableEntityContextRegistration: true})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = client.Close() }()
	client.provider.applyDefinitions([]definitions.FeatureDefinitionModel{{FeatureKey: "checkout"}})
	now := time.Now().UTC()
	client.provider.mu.Lock()
	client.provider.etag = "revision-1"
	client.provider.lastTS = 42
	client.provider.lastErr = "stale network"
	client.provider.lastErrTime = &now
	client.provider.lastRefresh = &now
	client.provider.mu.Unlock()
	client.provider.liveMu.Lock()
	client.provider.liveCloser = testCloser{}
	client.provider.liveMu.Unlock()

	info := client.ProviderDebugInfo()
	if info.AppKey != "app" || info.Environment != "Staging" || info.DefinitionsCount != 1 || info.ETag != "revision-1" || info.LastTimestamp != 42 || info.LastError != "stale network" || info.LastErrorTime != &now || info.LastRefresh != &now || !info.LiveUpdatesEnabled || !info.LiveUpdatesRunning {
		t.Fatalf("provider debug info = %+v", info)
	}
}
