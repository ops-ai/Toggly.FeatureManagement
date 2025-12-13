package crypto

import (
	"crypto/ecdsa"
	"crypto/sha256"
	"fmt"
	"strconv"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/definitions"
)

// VerifySignedDefinitions verifies a signed definitions response.
//
// It expects:
// - env.Defs is the exact raw JSON bytes from the "defs" property
// - env.Timestamp is the integer timestamp (Unix seconds)
// - env.Signature is base64 (standard) encoding of the ES256 signature
func VerifySignedDefinitions(env *definitions.SignedDefinitionsResponse, jwks *definitions.JWKSet, allowedKid map[string]struct{}) error {
	if env == nil {
		return fmt.Errorf("nil signed response")
	}
	if jwks == nil {
		return fmt.Errorf("nil jwks")
	}

	pub, err := findKey(jwks, env.Kid, allowedKid)
	if err != nil {
		return err
	}

	payload := string(env.Defs) + "|" + strconv.FormatInt(env.Timestamp, 10)
	h := sha256.Sum256([]byte(payload))

	sig, err := DecodeB64Std(env.Signature)
	if err != nil {
		return fmt.Errorf("decode signature: %w", err)
	}

	// Azure KeyVault ES256 signatures are DER-encoded (ASN.1) and match .NET ECDsa.VerifyHash.
	if !ecdsa.VerifyASN1(pub, h[:], sig) {
		return fmt.Errorf("invalid signature")
	}
	return nil
}

func findKey(jwks *definitions.JWKSet, kid string, allowedKid map[string]struct{}) (*ecdsa.PublicKey, error) {
	for _, k := range jwks.Keys {
		if k.Kid != kid {
			continue
		}
		pub, err := ValidateAndParseES256Key(k, allowedKid)
		if err != nil {
			return nil, err
		}
		return pub, nil
	}
	return nil, fmt.Errorf("no matching jwk for kid %q", kid)
}
