package snapshot

import (
	"context"
	"time"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/definitions"
)

// DefinitionsSnapshot stores cached feature definitions.
type DefinitionsSnapshot struct {
	Defs      []definitions.FeatureDefinitionModel
	Signature string
	Kid       string
	Timestamp int64

	// VariantDefs is set when definitions came from evaluated-variants-signed.
	// Omitempty keeps JSON backward compatible with older snapshots.
	VariantDefs      map[string]definitions.EvaluatedVariantDef `json:"variantDefs,omitempty"`
	VariantSignature string                                     `json:"variantSignature,omitempty"`
	VariantKid       string                                     `json:"variantKid,omitempty"`
	VariantTimestamp int64                                      `json:"variantTimestamp,omitempty"`
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
	LoadJWKS(ctx context.Context) (*JWKSnap, error)
	SaveJWKS(ctx context.Context, snap JWKSnap) error
}
