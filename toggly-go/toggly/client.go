package toggly

import (
	"context"
	"errors"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/definitions"
	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/eval"
	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/metrics"
	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/usage"
)

// VariantResult is the assigned variant for a feature from evaluated-variants-signed.
type VariantResult struct {
	Name               string
	ConfigurationValue interface{}
}

// EvaluatedVariantDef is the raw evaluated entry from evaluated-variants-signed `defs`
// (alias of definitions.EvaluatedVariantDef).
type EvaluatedVariantDef = definitions.EvaluatedVariantDef

// Client is the main entrypoint for evaluating feature flags.
//
// In this repository we implement local evaluation backed by periodically refreshed definitions.
type Client struct {
	cfg      Config
	provider *definitionsProvider
	engine   *eval.Engine
	registry *eval.Registry

	usage   *usage.Client
	metrics *metrics.Client
}

// NewClient creates a new Toggly client.
func NewClient(cfg Config) (*Client, error) {
	cfg.applyDefaults()
	if cfg.AppKey == "" {
		return nil, errors.New("toggly: AppKey is required")
	}

	p := newDefinitionsProvider(cfg, cfg.SnapshotProvider)
	reg := eval.DefaultRegistry()
	eng := eval.NewEngine(reg)
	c := &Client{cfg: cfg, provider: p, engine: eng, registry: reg}

	if cfg.EnableUsage {
		if cfg.UsageClient != nil {
			c.usage = cfg.UsageClient
		} else {
			u, err := usage.Dial(cfg.BaseURL, cfg.AppKey, cfg.Environment, cfg.InstanceName, cfg.AppVersion)
			if err != nil {
				return nil, err
			}
			c.usage = u
		}
		c.usage.StartAutoFlush(cfg.UsageFlushInterval)
	}

	if cfg.EnableMetrics {
		if cfg.MetricsClient != nil {
			c.metrics = cfg.MetricsClient
		} else {
			m, err := metrics.Dial(cfg.BaseURL, cfg.AppKey, cfg.Environment, cfg.InstanceName)
			if err != nil {
				return nil, err
			}
			c.metrics = m
		}
		c.metrics.StartAutoFlush(cfg.MetricsFlushInterval)
	}

	if !cfg.DisableBackgroundRefresh {
		p.start()
	}
	go registerEntityContextsAtStartup(cfg)
	return c, nil
}

// SetVariantIdentity updates the userId query parameter for evaluated-variants-signed
// refreshes when Config.EnableVariants is true. Changing identity clears the variant ETag
// so the next refresh fetches fresh data.
func (c *Client) SetVariantIdentity(identity string) {
	if c == nil || c.provider == nil {
		return
	}
	c.provider.setVariantIdentity(identity)
}

// GetVariant returns the assigned variant for a feature, or nil if none or unknown key.
// Requires Config.EnableVariants and a non-empty variant name in the server response.
func (c *Client) GetVariant(featureKey string) *VariantResult {
	if c == nil || c.provider == nil {
		return nil
	}
	return c.provider.getVariant(featureKey)
}

// GetVariantValue returns the configuration value for the assigned variant, or nil.
func (c *Client) GetVariantValue(featureKey string) interface{} {
	v := c.GetVariant(featureKey)
	if v == nil {
		return nil
	}
	return v.ConfigurationValue
}

// Close stops background refresh (if enabled) and closes optional gRPC clients.
func (c *Client) Close() error {
	if c.provider != nil {
		c.provider.close()
	}
	if c.usage != nil {
		_ = c.usage.Close()
	}
	if c.metrics != nil {
		_ = c.metrics.Close()
	}
	return nil
}

// IsEnabled evaluates a feature flag.
func (c *Client) IsEnabled(ctx context.Context, featureKey string, evalCtx Context) (bool, error) {
	if featureKey == "" {
		return false, errors.New("toggly: featureKey is required")
	}

	def, ok := c.provider.get(featureKey)
	if !ok {
		if c.cfg.EnableUndefinedOnDevelopment {
			return true, nil
		}
		return false, nil
	}

	// Session stickiness for non-deterministic rollouts.
	if c.cfg.SessionStore != nil && evalCtx.Identity != "" && shouldUseSession(def) {
		if v, err := c.cfg.SessionStore.Get(ctx, evalCtx.Identity, featureKey); err == nil && v != nil {
			return *v, nil
		}
	}

	inner := eval.Context{
		Identity: evalCtx.Identity,
		Groups:   evalCtx.Groups,
		Traits:   evalCtx.Traits,
	}
	if evalCtx.Entity != nil {
		inner.Entity = &eval.EntityContext{
			Kind:       evalCtx.Entity.Kind,
			Key:        evalCtx.Entity.Key,
			Attributes: evalCtx.Entity.Attributes,
		}
	}
	res, err := c.engine.Evaluate(def, inner)
	if err != nil {
		return false, err
	}

	// Secure features require an additional authorization check when enabled.
	if res && c.cfg.AuthorizationService != nil && c.provider.isSecure(featureKey) {
		allowed, err := c.cfg.AuthorizationService.IsAllowed(ctx, featureKey, evalCtx)
		if err != nil {
			return false, err
		}
		if !allowed {
			return false, nil
		}
	}

	if c.usage != nil {
		c.usage.RecordCheck(featureKey, res, evalCtx.Identity)
	}

	if c.cfg.SessionStore != nil && evalCtx.Identity != "" && shouldUseSession(def) {
		_ = c.cfg.SessionStore.Set(ctx, evalCtx.Identity, featureKey, res, c.cfg.SessionTTL)
	}

	return res, nil
}

// Requirement controls how a feature gate of multiple features is evaluated.
type Requirement string

const (
	RequirementAny Requirement = "Any"
	RequirementAll Requirement = "All"
)

// EvaluateGate evaluates a feature gate: Any/All over multiple features.
func (c *Client) EvaluateGate(ctx context.Context, featureKeys []string, req Requirement, evalCtx Context, negate bool) (bool, error) {
	if len(featureKeys) == 0 {
		return false, nil
	}

	switch req {
	case RequirementAll:
		for _, k := range featureKeys {
			enabled, err := c.IsEnabled(ctx, k, evalCtx)
			if err != nil {
				return false, err
			}
			if negate {
				enabled = !enabled
			}
			if !enabled {
				return false, nil
			}
		}
		return true, nil
	case RequirementAny:
		fallthrough
	default:
		for _, k := range featureKeys {
			enabled, err := c.IsEnabled(ctx, k, evalCtx)
			if err != nil {
				return false, err
			}
			if negate {
				enabled = !enabled
			}
			if enabled {
				return true, nil
			}
		}
		return false, nil
	}
}

// RegisterFilter registers a custom feature filter evaluator.
// The name must match the filter Name returned in definitions (e.g., "Targeting").
func (c *Client) RegisterFilter(name string, evaluator eval.Evaluator) {
	if c == nil || c.registry == nil {
		return
	}
	c.registry.Register(name, evaluator)
}

// RecordUsage increments the "used" counter for a feature.
// This is separate from IsEnabled checks.
func (c *Client) RecordUsage(featureKey string, enabled bool, evalCtx Context) {
	if c == nil || c.usage == nil {
		return
	}
	c.usage.RecordUsed(featureKey, enabled, evalCtx.Identity)
}

// MetricsClient returns the underlying metrics client (if enabled).
func (c *Client) MetricsClient() *metrics.Client {
	if c == nil {
		return nil
	}
	return c.metrics
}
