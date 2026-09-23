package definitions

import "encoding/json"

// RequirementType mirrors the server-side requirement type.
type RequirementType string

const (
	RequirementAny RequirementType = "Any"
	RequirementAll RequirementType = "All"
)

// FeatureFilter mirrors the server-side filter object.
//
// NOTE: The server may emit scalar values (string/number/bool) in Parameters,
// so we use map[string]any for safe decoding.
type FeatureFilter struct {
	Name       string         `json:"name"`
	Parameters map[string]any `json:"parameters"`
}

// FeatureDefinitionModel is the shape returned by /definitions/{appKey}/{env}.
//
// It also matches the Defs payload inside the signed response (/definitions-signed/{appKey}/{env}).
type FeatureDefinitionModel struct {
	FeatureKey             string          `json:"featureKey"`
	Filters                []FeatureFilter `json:"filters"`
	Metrics                []string        `json:"metrics"`
	SecuredFeature         bool            `json:"securedFeature"`
	ClientSdkEnabled       bool            `json:"clientSdkEnabled"`
	RequirementType        RequirementType `json:"requirementType"`
	ContextKind            string          `json:"contextKind,omitempty"`
	ContextRequirementType RequirementType `json:"contextRequirementType,omitempty"`

	// Variants are named variants (Microsoft.FeatureManagement.VariantDefinition schema).
	// Catalog-local variant assignment (see the variant package) requires this
	// to be non-empty; an empty/missing slice means the feature has no variants
	// (assignment reason "None").
	Variants []VariantDefinition `json:"variants,omitempty"`

	// Allocation is the variant allocation ruleset (Microsoft.FeatureManagement.Allocation
	// schema). Nil means no allocation is configured; the effective variant is
	// then always unassigned, though the assignment reason still reports
	// DefaultWhenEnabled/DefaultWhenDisabled (matching Microsoft.FeatureManagement).
	Allocation *AllocationDefinition `json:"allocation,omitempty"`
}

// SignedDefinitionsResponse is the envelope returned by /definitions-signed/{appKey}/{env}.
//
// IMPORTANT: Defs is raw JSON bytes so signature verification can use the
// exact server-signed payload.
type SignedDefinitionsResponse struct {
	Defs      json.RawMessage `json:"defs"`
	Signature string          `json:"signature"`
	Timestamp int64           `json:"timestamp"`
	Kid       string          `json:"kid"`
}

// StatusOverride mirrors Microsoft.FeatureManagement.StatusOverride: a variant
// can force the feature's effective enabled state when it is assigned.
type StatusOverride string

const (
	StatusOverrideNone     StatusOverride = "None"
	StatusOverrideEnabled  StatusOverride = "Enabled"
	StatusOverrideDisabled StatusOverride = "Disabled"
)

// VariantDefinition mirrors Microsoft.FeatureManagement.VariantDefinition.
type VariantDefinition struct {
	// Name of the variant. Matched by exact (ordinal) comparison against
	// Allocation.DefaultWhenEnabled / DefaultWhenDisabled / User / Group / Percentile entries.
	Name string `json:"name"`

	// ConfigurationValue is the untyped wire configuration payload for this variant
	// (object, array, scalar, or null). Callers needing typed access should
	// decode this themselves (see OPS-1365 for typed getVariantValue<T> follow-up).
	ConfigurationValue interface{} `json:"configurationValue"`

	// StatusOverride optionally forces the feature's effective enabled state
	// when this variant is assigned.
	StatusOverride StatusOverride `json:"statusOverride,omitempty"`
}

// AllocationDefinition mirrors Microsoft.FeatureManagement.Allocation.
type AllocationDefinition struct {
	// DefaultWhenEnabled names the variant assigned when the feature is enabled
	// and no User/Group/Percentile rule matches.
	DefaultWhenEnabled *string `json:"defaultWhenEnabled,omitempty"`

	// DefaultWhenDisabled names the variant assigned when the feature is disabled.
	DefaultWhenDisabled *string `json:"defaultWhenDisabled,omitempty"`

	// Seed overrides the percentile hash hint. When nil, the hint defaults to
	// "allocation\n{featureKey}" (Microsoft.FeatureManagement parity).
	Seed *string `json:"seed,omitempty"`

	// User allocations are checked first (in order); the first entry whose
	// Users contains the targeting UserID wins.
	User []UserAllocation `json:"user,omitempty"`

	// Group allocations are checked second (in order); the first entry with
	// any overlap against the targeting Groups wins.
	Group []GroupAllocation `json:"group,omitempty"`

	// Percentile allocations are checked last (in order); the first bucket
	// containing the computed context percentage wins.
	Percentile []PercentileAllocation `json:"percentile,omitempty"`
}

// UserAllocation mirrors Microsoft.FeatureManagement.UserAllocation.
type UserAllocation struct {
	Variant string   `json:"variant"`
	Users   []string `json:"users,omitempty"`
}

// GroupAllocation mirrors Microsoft.FeatureManagement.GroupAllocation.
type GroupAllocation struct {
	Variant string   `json:"variant"`
	Groups  []string `json:"groups,omitempty"`
}

// PercentileAllocation mirrors Microsoft.FeatureManagement.PercentileAllocation.
type PercentileAllocation struct {
	Variant string  `json:"variant"`
	From    float64 `json:"from"`
	To      float64 `json:"to"`
}

// JWKSet is the shape returned by /.well-known/jwks.
type JWKSet struct {
	Keys []JWK `json:"keys"`
}

// JWK is a single JSON Web Key.
type JWK struct {
	Kty string `json:"kty"`
	Use string `json:"use"`
	Kid string `json:"kid"`
	Crv string `json:"crv"`
	X   string `json:"x"`
	Y   string `json:"y"`
	Alg string `json:"alg"`
	Exp *int64 `json:"exp"`
}
