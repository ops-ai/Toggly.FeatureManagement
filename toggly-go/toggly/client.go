package toggly

import (
	"context"
	"errors"
	"sync"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/eval"
	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/metrics"
	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/usage"
	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/variant"
)

// VariantResult is the outcome of catalog-local, Microsoft.FeatureManagement
// 4.7.0-parity variant assignment for a feature.
type VariantResult struct {
	// Name is the assigned variant's name.
	Name string

	// ConfigurationValue is the assigned variant's untyped wire configuration
	// payload (object, array, scalar, or null).
	ConfigurationValue interface{}

	// Enabled is the effective enabled state after the assigned variant's
	// StatusOverride is applied (matches Microsoft.FeatureManagement's
	// GetVariantAsync semantics). IsEnabled remains purely filter-based and
	// does not apply StatusOverride; use this field when you need
	// MF-identical effective-enabled behavior for a variant feature.
	Enabled bool
}

// Client is the main entrypoint for evaluating feature flags.
//
// In this repository we implement local evaluation backed by periodically refreshed definitions.
type Client struct {
	cfg      Config
	provider *definitionsProvider
	engine   *eval.Engine
	registry *eval.Registry

	// identity is the mutable default targeting userId (from Config.Identity,
	// overridable via SetIdentity). Guarded by identityMu.
	identityMu sync.RWMutex
	identity   string

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
	c := &Client{cfg: cfg, provider: p, engine: eng, registry: reg, identity: cfg.Identity}

	ua := SDKUserAgent()
	if cfg.EnableUsage {
		if cfg.UsageClient != nil {
			c.usage = cfg.UsageClient
		} else {
			u, err := usage.Dial(cfg.MetricsURL, cfg.AppKey, cfg.Environment, cfg.InstanceName, cfg.AppVersion, ua)
			if err != nil {
				return nil, err
			}
			c.usage = u
		}
		c.usage.StartAutoFlush(cfg.UsageFlushInterval)
		p.setDefinitionCacheRecorder(c.usage)
	}

	if cfg.EnableMetrics {
		if cfg.MetricsClient != nil {
			c.metrics = cfg.MetricsClient
		} else {
			m, err := metrics.Dial(cfg.MetricsURL, cfg.AppKey, cfg.Environment, cfg.InstanceName, ua)
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

// GetVariant assigns a feature variant locally from the cached definitions
// catalog, replaying the Microsoft.FeatureManagement 4.7.0 allocator
// (disabled → DefaultWhenDisabled only; enabled → User → Group → Percentile →
// DefaultWhenEnabled). Returns nil when the feature is unknown or has no
// Variants configured.
//
// Targeting identity resolution (first non-empty wins):
//  1. per-call evalCtx.Identity
//  2. ambient WithEvalContext / togglyctx.With on ctx
//  3. Config.Identity / Client.SetIdentity
//
// Groups come only from ambient or per-call Context (never Config). Prefer
// GetVariant(r.Context(), key, Context{}) after HTTP middleware, or
// SetIdentity / Config.Identity for non-HTTP hosts — not a hand-built
// Identity on every call.
func (c *Client) GetVariant(ctx context.Context, featureKey string, evalCtx Context) (*VariantResult, error) {
	if featureKey == "" {
		return nil, errors.New("toggly: featureKey is required")
	}
	if c == nil || c.provider == nil {
		return nil, nil
	}

	evalCtx = c.resolveTargetingContext(ctx, evalCtx)

	def, ok := c.provider.get(featureKey)
	if !ok || len(def.Variants) == 0 {
		return nil, nil
	}

	baseEnabled, err := c.engine.Evaluate(def, toEvalContext(evalCtx))
	if err != nil {
		return nil, err
	}

	// Match IsEnabled: secure features require AuthorizationService approval
	// before variant assignment treats the flag as enabled.
	if baseEnabled && c.cfg.AuthorizationService != nil && c.provider.isSecure(featureKey) {
		allowed, err := c.cfg.AuthorizationService.IsAllowed(ctx, featureKey, evalCtx)
		if err != nil {
			return nil, err
		}
		baseEnabled = allowed
	}

	assignment := variant.Assign(def, baseEnabled, variant.TargetingContext{
		UserID: evalCtx.Identity,
		Groups: evalCtx.Groups,
	}, c.cfg.VariantIgnoreCase)

	if assignment.Variant == nil {
		return nil, nil
	}
	return &VariantResult{
		Name:               assignment.Variant.Name,
		ConfigurationValue: assignment.Variant.ConfigurationValue,
		Enabled:            assignment.Enabled,
	}, nil
}

// GetVariantValue returns the configuration payload for the assigned variant,
// or nil when no variant was assigned. See GetVariant.
func (c *Client) GetVariantValue(ctx context.Context, featureKey string, evalCtx Context) (interface{}, error) {
	v, err := c.GetVariant(ctx, featureKey, evalCtx)
	if err != nil || v == nil {
		return nil, err
	}
	return v.ConfigurationValue, nil
}

// SetIdentity updates the client's default targeting userId used when neither
// ambient nor per-call Context supplies Identity.
func (c *Client) SetIdentity(identity string) {
	if c == nil {
		return
	}
	c.identityMu.Lock()
	c.identity = identity
	c.identityMu.Unlock()
}

// Identity returns the client's current default targeting userId.
func (c *Client) Identity() string {
	if c == nil {
		return ""
	}
	c.identityMu.RLock()
	defer c.identityMu.RUnlock()
	return c.identity
}

// resolveTargetingContext merges ambient → per-call, then fills empty Identity
// from the client default (Config.Identity / SetIdentity).
func (c *Client) resolveTargetingContext(ctx context.Context, perCall Context) Context {
	merged := ResolveEvalContext(ctx, perCall)
	if merged.Identity == "" && c != nil {
		c.identityMu.RLock()
		id := c.identity
		c.identityMu.RUnlock()
		if id != "" {
			merged.Identity = id
		}
	}
	return merged
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
//
// When ctx carries ambient evaluation context (via WithEvalContext / togglyctx.With),
// empty or nil per-call fields are filled from ambient; non-empty per-call fields win.
func (c *Client) IsEnabled(ctx context.Context, featureKey string, evalCtx Context) (bool, error) {
	if featureKey == "" {
		return false, errors.New("toggly: featureKey is required")
	}

	evalCtx = c.resolveTargetingContext(ctx, evalCtx)

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

	res, err := c.engine.Evaluate(def, toEvalContext(evalCtx))
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

// toEvalContext maps the public Context to the internal eval.Context used by
// the filter engine, shared by IsEnabled and GetVariant.
func toEvalContext(evalCtx Context) eval.Context {
	inner := eval.Context{
		Identity: evalCtx.Identity,
		Groups:   evalCtx.Groups,
		Traits:   evalCtx.Traits,
		Claims:   evalCtx.Claims,
	}
	if evalCtx.Request != nil {
		inner.Request = &eval.RequestContext{
			UserAgent:      evalCtx.Request.UserAgent,
			AcceptLanguage: evalCtx.Request.AcceptLanguage,
			Country:        evalCtx.Request.Country,
		}
	}
	if evalCtx.Entity != nil {
		inner.Entity = &eval.EntityContext{
			Kind:       evalCtx.Entity.Kind,
			Key:        evalCtx.Entity.Key,
			Attributes: evalCtx.Entity.Attributes,
		}
	}
	return inner
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

// RecordView increments the "viewed" counter for a feature (rendered/displayed).
// This is separate from IsEnabled checks and RecordUsage.
func (c *Client) RecordView(featureKey string, evalCtx Context) {
	if c == nil || c.usage == nil {
		return
	}
	c.usage.RecordView(featureKey, evalCtx.Identity)
}

// MetricsClient returns the underlying metrics client (if enabled).
func (c *Client) MetricsClient() *metrics.Client {
	if c == nil {
		return nil
	}
	return c.metrics
}
