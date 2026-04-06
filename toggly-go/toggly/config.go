package toggly

import (
	"time"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/metrics"
	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/secure"
	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/session"
	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/snapshot"
	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/usage"
)

// Config configures a Toggly client.
//
// This mirrors the .NET TogglySettings shape.
type Config struct {
	AppKey         string
	Environment    string
	BaseURL        string
	DefinitionsURL string

	UseSignedDefinitions bool
	AllowedKeyIDs        map[string]struct{}

	// EnableVariants loads evaluated feature variants from evaluated-variants-signed
	// (server-side evaluation) instead of definitions or definitions-signed.
	// When true, UseSignedDefinitions controls whether responses are signature-verified.
	EnableVariants bool

	// VariantIdentity is sent as the userId query parameter for evaluated-variants-signed.
	// For per-request identity (e.g. HTTP servers), use Client.SetVariantIdentity.
	VariantIdentity string

	AppVersion   string
	InstanceName string

	// RefreshInterval controls how often the client refreshes definitions.
	// If zero, a default is applied.
	RefreshInterval time.Duration

	// HTTPTimeout applies to definition refresh calls.
	HTTPTimeout time.Duration

	// EnableUndefinedOnDevelopment enables undefined flags by default.
	// In .NET this is gated behind IsDevelopment(); in Go the caller controls usage.
	EnableUndefinedOnDevelopment bool

	// SnapshotProvider persists feature definitions and JWKS for faster startup / offline use.
	SnapshotProvider snapshot.Provider

	// SessionStore enables sticky results for non-deterministic rollouts (percentage).
	// If nil, percentage rollouts may vary between calls.
	SessionStore session.Store

	// SessionTTL controls how long sticky results are kept.
	SessionTTL time.Duration

	// AuthorizationService is an optional hook for secured features.
	// If nil, secured features behave like normal feature flags.
	AuthorizationService secure.AuthorizationService

	// EnableUsage enables usage statistics batching and send via gRPC.
	EnableUsage        bool
	UsageFlushInterval time.Duration
	UsageClient        *usage.Client

	// EnableMetrics enables metrics batching and send via gRPC.
	EnableMetrics        bool
	MetricsFlushInterval time.Duration
	MetricsClient        *metrics.Client

	// DisableBackgroundRefresh prevents starting the background refresh loop.
	// The caller can call Refresh manually (not yet exposed) if needed.
	DisableBackgroundRefresh bool

	// EnableLiveUpdates enables WebSocket live updates (direct worker websocket).
	EnableLiveUpdates bool
}

func (c *Config) applyDefaults() {
	if c.Environment == "" {
		c.Environment = "Production"
	}
	if c.BaseURL == "" {
		c.BaseURL = "https://app.toggly.io/"
	}
	if c.BaseURL != "" && c.BaseURL[len(c.BaseURL)-1] != '/' {
		c.BaseURL += "/"
	}
	if c.DefinitionsURL == "" {
		c.DefinitionsURL = "https://definitions.toggly.io/"
	}
	if c.DefinitionsURL != "" && c.DefinitionsURL[len(c.DefinitionsURL)-1] != '/' {
		c.DefinitionsURL += "/"
	}
	if c.RefreshInterval == 0 {
		c.RefreshInterval = 5 * time.Minute
	}
	if c.HTTPTimeout == 0 {
		c.HTTPTimeout = 10 * time.Second
	}
	if c.AllowedKeyIDs == nil {
		c.AllowedKeyIDs = map[string]struct{}{}
	}
	if c.SessionTTL == 0 {
		c.SessionTTL = 30 * time.Minute
	}
	if c.UsageFlushInterval == 0 {
		c.UsageFlushInterval = time.Minute
	}
	if c.MetricsFlushInterval == 0 {
		c.MetricsFlushInterval = time.Minute
	}
}
