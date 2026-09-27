package toggly

import (
	"context"
	"errors"
	"testing"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/definitions"
)

const (
	secureOnFeature  = "secure-on"
	secureOffFeature = "secure-off"
)

type recordingAuthorization struct {
	allowed bool
	err     error
	calls   int
}

func (a *recordingAuthorization) IsAllowed(context.Context, string, any) (bool, error) {
	a.calls++
	return a.allowed, a.err
}

func TestNewClientConfiguresOptionalTelemetry(t *testing.T) {
	client, err := NewClient(Config{
		AppKey: "app", MetricsURL: "https://localhost:1/",
		EnableUsage: true, EnableMetrics: true,
		DisableBackgroundRefresh: true, DisableEntityContextRegistration: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if client.usage == nil || client.provider.cacheRecorder != client.usage || client.MetricsClient() == nil {
		t.Fatal("optional usage and metrics clients were not configured")
	}
	if err := client.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestIsEnabledAuthorizesOnlyEnabledSecureFeatures(t *testing.T) {
	authorizer := &recordingAuthorization{allowed: true}
	client, err := NewClient(Config{
		AppKey: "app", AuthorizationService: authorizer,
		DisableBackgroundRefresh: true, DisableEntityContextRegistration: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = client.Close() }()
	client.provider.applyDefinitions([]definitions.FeatureDefinitionModel{
		{FeatureKey: secureOnFeature, SecuredFeature: true, Filters: []definitions.FeatureFilter{{Name: "AlwaysOn"}}},
		{FeatureKey: secureOffFeature, SecuredFeature: true, Filters: []definitions.FeatureFilter{{Name: "AlwaysOff"}}},
	})
	ctx := context.Background()
	if on, err := client.IsEnabled(ctx, secureOnFeature, Context{}); err != nil || !on || authorizer.calls != 1 {
		t.Fatalf("authorized feature = %t, %v, calls = %d", on, err, authorizer.calls)
	}
	authorizer.allowed = false
	if on, err := client.IsEnabled(ctx, secureOnFeature, Context{}); err != nil || on || authorizer.calls != 2 {
		t.Fatalf("denied feature = %t, %v, calls = %d", on, err, authorizer.calls)
	}
	authorizer.err = errors.New("authorization unavailable")
	if on, err := client.IsEnabled(ctx, secureOnFeature, Context{}); err == nil || on || authorizer.calls != 3 {
		t.Fatalf("authorization error = %t, %v, calls = %d", on, err, authorizer.calls)
	}
	if on, err := client.IsEnabled(ctx, secureOffFeature, Context{}); err != nil || on || authorizer.calls != 3 {
		t.Fatalf("disabled secure feature = %t, %v, calls = %d", on, err, authorizer.calls)
	}
}
