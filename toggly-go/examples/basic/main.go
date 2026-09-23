package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly"
	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/session"
)

func main() {
	client, err := toggly.NewClient(toggly.Config{
		AppKey:         "YOUR_APP_KEY",
		Environment:    "Production",
		BaseURL:        "https://app.toggly.io/",
		DefinitionsURL: "https://definitions.toggly.io/",
		SessionStore:   session.NewMemoryStore(),
		SessionTTL:     30 * time.Minute,

		EnableLiveUpdates: true,
		EnableUsage:       true,
		EnableMetrics:     true,
	})
	if err != nil {
		log.Fatal(err)
	}
	defer func() { _ = client.Close() }()

	evalCtx := toggly.Context{
		Identity: "user-123",
		Groups:   []string{"beta"},
		Traits:   map[string]any{"country": "US"},
	}

	on, err := client.IsEnabled(context.Background(), "MyFeature", evalCtx)
	if err != nil {
		log.Fatal(err)
	}

	fmt.Printf("MyFeature enabled: %v\n", on)

	// Example: catalog-local variant assignment (no extra network call).
	if variant, err := client.GetVariant(context.Background(), "MyFeature", evalCtx); err != nil {
		log.Fatal(err)
	} else if variant != nil {
		fmt.Printf("MyFeature variant: %s (enabled=%v)\n", variant.Name, variant.Enabled)
	}

	// Record usage / view separately from checks.
	client.RecordUsage("MyFeature", on, evalCtx)
	client.RecordView("MyFeature", evalCtx)

	// Example: emit a metric (if enabled). Empty variant defaults to "enabled".
	if m := client.MetricsClient(); m != nil {
		featureKey := "MyFeature"
		m.Increment("MyFeature.Counter", 1, &featureKey, "")
	}
}
