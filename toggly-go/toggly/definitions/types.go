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
// It also matches the Defs payload inside the signed response (/definitions/v2).
type FeatureDefinitionModel struct {
	FeatureKey       string          `json:"featureKey"`
	Filters          []FeatureFilter `json:"filters"`
	Metrics          []string        `json:"metrics"`
	SecuredFeature   bool            `json:"securedFeature"`
	ClientSdkEnabled bool            `json:"clientSdkEnabled"`
	RequirementType  RequirementType `json:"requirementType"`
}

// SignedDefinitionsResponse is the envelope returned by /definitions/v2/{appKey}/{env}.
//
// IMPORTANT: Defs is raw JSON bytes so signature verification can use the
// exact server-signed payload.
type SignedDefinitionsResponse struct {
	Defs      json.RawMessage `json:"defs"`
	Signature string          `json:"signature"`
	Timestamp int64           `json:"timestamp"`
	Kid       string          `json:"kid"`
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
	Exp *int64  `json:"exp"`
}
