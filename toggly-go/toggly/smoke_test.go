package toggly

import (
	"context"
	"os"
	"testing"
	"time"
)

const (
	smokeEnvName = "Production"
	flagOn       = "FlagOn"
	flagOff      = "FlagOff"
)

func TestSmoke_UnsignedDefinitions(t *testing.T) {
	appKey := os.Getenv("TOGGLY_SMOKE_APP_KEY_BACKEND")
	if appKey == "" {
		t.Skip("TOGGLY_SMOKE_APP_KEY_BACKEND is not set")
	}

	client, err := NewClient(Config{
		AppKey:               appKey,
		Environment:          smokeEnvName,
		DefinitionsURL:       "https://definitions.toggly.io/",
		UseSignedDefinitions: false,
		RefreshInterval:      30 * time.Second,
		HTTPTimeout:          10 * time.Second,
	})
	if err != nil {
		t.Fatalf("NewClient failed: %v", err)
	}
	defer func() { _ = client.Close() }()

	assertSmokeFlags(t, client)
}

func TestSmoke_SignedDefinitions(t *testing.T) {
	appKey := os.Getenv("TOGGLY_SMOKE_APP_KEY_BACKEND")
	if appKey == "" {
		t.Skip("TOGGLY_SMOKE_APP_KEY_BACKEND is not set")
	}

	client, err := NewClient(Config{
		AppKey:               appKey,
		Environment:          smokeEnvName,
		DefinitionsURL:       "https://definitions.toggly.io/",
		UseSignedDefinitions: true,
		RefreshInterval:      30 * time.Second,
		HTTPTimeout:          10 * time.Second,
	})
	if err != nil {
		t.Fatalf("NewClient failed: %v", err)
	}
	defer func() { _ = client.Close() }()

	assertSmokeFlags(t, client)
}

func TestSmoke_WebSocket(t *testing.T) {
	appKey := os.Getenv("TOGGLY_SMOKE_APP_KEY_BACKEND")
	if appKey == "" {
		t.Skip("TOGGLY_SMOKE_APP_KEY_BACKEND is not set")
	}

	client, err := NewClient(Config{
		AppKey:            appKey,
		Environment:       smokeEnvName,
		DefinitionsURL:    "https://definitions.toggly.io/",
		EnableLiveUpdates: true,
		RefreshInterval:   30 * time.Second,
		HTTPTimeout:       10 * time.Second,
	})
	if err != nil {
		t.Fatalf("NewClient failed: %v", err)
	}
	defer func() { _ = client.Close() }()

	// Verify flags are available after initial fetch
	assertSmokeFlags(t, client)

	// Wait for the SDK's built-in WebSocket to connect
	deadline := time.Now().Add(15 * time.Second)
	var connected bool
	for time.Now().Before(deadline) {
		info := client.ProviderDebugInfo()
		if info.LiveUpdatesRunning {
			connected = true
			break
		}
		time.Sleep(500 * time.Millisecond)
	}

	if !connected {
		t.Fatal("SDK WebSocket should be running within 15 seconds")
	}

	// Verify flags still work after WebSocket is connected
	ctx := context.Background()
	on, err := client.IsEnabled(ctx, flagOn, Context{})
	if err != nil {
		t.Fatalf("IsEnabled(FlagOn) failed: %v", err)
	}
	if !on {
		t.Fatal("FlagOn should be enabled after WebSocket connected")
	}

	off, err := client.IsEnabled(ctx, flagOff, Context{})
	if err != nil {
		t.Fatalf("IsEnabled(FlagOff) failed: %v", err)
	}
	if off {
		t.Fatal("FlagOff should be disabled after WebSocket connected")
	}
}

func assertSmokeFlags(t *testing.T, client *Client) {
	t.Helper()

	ctx := context.Background()
	deadline := time.Now().Add(30 * time.Second)
	var lastErr error

	for time.Now().Before(deadline) {
		on, errOn := client.IsEnabled(ctx, flagOn, Context{})
		off, errOff := client.IsEnabled(ctx, flagOff, Context{})

		if errOn == nil && errOff == nil && on && !off {
			return
		}

		if errOn != nil {
			lastErr = errOn
		} else if errOff != nil {
			lastErr = errOff
		}

		time.Sleep(500 * time.Millisecond)
	}

	if lastErr != nil {
		t.Fatalf("smoke assertions failed with latest error: %v", lastErr)
	}

	on, _ := client.IsEnabled(ctx, flagOn, Context{})
	off, _ := client.IsEnabled(ctx, flagOff, Context{})
	t.Fatalf("unexpected smoke flag values: FlagOn=%v FlagOff=%v", on, off)
}
