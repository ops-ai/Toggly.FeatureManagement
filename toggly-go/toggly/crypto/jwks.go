package crypto

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/definitions"
)

// ValidateAndParseES256Key validates a JWK and returns a usable ECDSA public key.
//
// Validation matches server + .NET SDK behavior:
// - alg must be ES256
// - curve must be P-256
// - kid must equal sha1(x||y) + "ES256"
func ValidateAndParseES256Key(jwk definitions.JWK, allowedKid map[string]struct{}) (*ecdsa.PublicKey, error) {
	if jwk.Alg != "ES256" {
		return nil, fmt.Errorf("unsupported alg: %q", jwk.Alg)
	}
	if jwk.Crv != "P-256" {
		return nil, fmt.Errorf("unsupported crv: %q", jwk.Crv)
	}
	if len(allowedKid) > 0 {
		if _, ok := allowedKid[jwk.Kid]; !ok {
			return nil, fmt.Errorf("kid not allowed: %q", jwk.Kid)
		}
	}

	xBytes, err := base64.RawURLEncoding.DecodeString(jwk.X)
	if err != nil {
		return nil, fmt.Errorf("decode x: %w", err)
	}
	yBytes, err := base64.RawURLEncoding.DecodeString(jwk.Y)
	if err != nil {
		return nil, fmt.Errorf("decode y: %w", err)
	}

	h := sha1.Sum(append(append([]byte{}, xBytes...), yBytes...))
	computed := strings.ToUpper(hex.EncodeToString(h[:])) + "ES256"
	if jwk.Kid != computed {
		return nil, fmt.Errorf("invalid kid: expected %q, got %q", computed, jwk.Kid)
	}

	// SEC 1 uncompressed point (0x04 || X || Y). ParseUncompressedPublicKey
	// validates the point is on P-256 (replaces deprecated PublicKey.{X,Y}
	// composite literals and elliptic.Curve.IsOnCurve).
	uncompressed := make([]byte, 1+len(xBytes)+len(yBytes))
	uncompressed[0] = 0x04
	copy(uncompressed[1:], xBytes)
	copy(uncompressed[1+len(xBytes):], yBytes)
	pub, err := ecdsa.ParseUncompressedPublicKey(elliptic.P256(), uncompressed)
	if err != nil {
		return nil, fmt.Errorf("point not on P-256: %w", err)
	}
	return pub, nil
}

// DecodeB64Std is used for signatures returned as base64 (standard) from the API.
func DecodeB64Std(s string) ([]byte, error) {
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return nil, fmt.Errorf("base64 decode: %w", err)
	}
	return b, nil
}
