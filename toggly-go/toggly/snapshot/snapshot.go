package snapshot

import (
	"context"
	"encoding/json"
	"time"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/definitions"
)

// DefinitionsSnapshot stores cached feature definitions.
type DefinitionsSnapshot struct {
	Defs      []definitions.FeatureDefinitionModel
	Signature string
	Kid       string
	Timestamp int64

	// RawDefs is the exact signed "defs" JSON from the server. Required for
	// cryptographic verification after a storage round-trip (never re-serialize).
	RawDefs json.RawMessage `json:"rawDefs,omitempty"`

	// ETag is the definitions revision for conditional fetches.
	ETag string `json:"etag,omitempty"`

	// VariantDefs is set when definitions came from evaluated-variants-signed.
	// Omitempty keeps JSON backward compatible with older snapshots.
	VariantDefs      map[string]definitions.EvaluatedVariantDef `json:"variantDefs,omitempty"`
	VariantSignature string                                     `json:"variantSignature,omitempty"`
	VariantKid       string                                     `json:"variantKid,omitempty"`
	VariantTimestamp int64                                      `json:"variantTimestamp,omitempty"`
	// VariantRawDefs is the exact signed defs JSON for evaluated-variants-signed.
	VariantRawDefs json.RawMessage `json:"variantRawDefs,omitempty"`
}

// JWKSnap stores cached JWKS.
type JWKSnap struct {
	Set    definitions.JWKSet
	Expiry time.Time
}

// Provider persists and retrieves cached definitions/JWKS.
//
// It is intentionally small so callers can implement Redis/SQL/etc.
type Provider interface {
	LoadDefinitions(ctx context.Context) (*DefinitionsSnapshot, error)
	SaveDefinitions(ctx context.Context, snap DefinitionsSnapshot) error
	// Clear removes persisted definitions and JWKS snapshots.
	Clear(ctx context.Context) error
	LoadJWKS(ctx context.Context) (*JWKSnap, error)
	SaveJWKS(ctx context.Context, snap JWKSnap) error
}
