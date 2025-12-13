package crypto

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"strconv"
	"strings"
	"testing"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/definitions"
)

func TestVerifySignedDefinitions_OK(t *testing.T) {
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}

	xBytes := pad32(priv.PublicKey.X.Bytes())
	yBytes := pad32(priv.PublicKey.Y.Bytes())
	kid := computeKid(xBytes, yBytes)

	jwk := definitions.JWK{
		Kty: "EC",
		Use: "sig",
		Alg: "ES256",
		Crv: "P-256",
		X:   base64.RawURLEncoding.EncodeToString(xBytes),
		Y:   base64.RawURLEncoding.EncodeToString(yBytes),
		Kid: kid,
	}
	jwks := &definitions.JWKSet{Keys: []definitions.JWK{jwk}}

	defs := []byte(`[{"featureKey":"demo","filters":[{"name":"AlwaysOn","parameters":{}}],"metrics":[],"securedFeature":false,"clientSdkEnabled":true,"requirementType":"Any"}]`)
	ts := int64(1730000000)
	payload := string(defs) + "|" + strconv.FormatInt(ts, 10)

	sig, err := ecdsa.SignASN1(rand.Reader, priv, sha256Bytes(payload))
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	env := &definitions.SignedDefinitionsResponse{
		Defs:      defs,
		Signature: base64.StdEncoding.EncodeToString(sig),
		Timestamp: ts,
		Kid:       kid,
	}

	if err := VerifySignedDefinitions(env, jwks, nil); err != nil {
		t.Fatalf("expected ok, got: %v", err)
	}
}

func TestVerifySignedDefinitions_AllowedKid(t *testing.T) {
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}

	xBytes := pad32(priv.PublicKey.X.Bytes())
	yBytes := pad32(priv.PublicKey.Y.Bytes())
	kid := computeKid(xBytes, yBytes)

	jwk := definitions.JWK{
		Kty: "EC",
		Use: "sig",
		Alg: "ES256",
		Crv: "P-256",
		X:   base64.RawURLEncoding.EncodeToString(xBytes),
		Y:   base64.RawURLEncoding.EncodeToString(yBytes),
		Kid: kid,
	}
	jwks := &definitions.JWKSet{Keys: []definitions.JWK{jwk}}

	defs := []byte(`[]`)
	ts := int64(1730000000)
	payload := string(defs) + "|" + strconv.FormatInt(ts, 10)
	sig, err := ecdsa.SignASN1(rand.Reader, priv, sha256Bytes(payload))
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	env := &definitions.SignedDefinitionsResponse{
		Defs:      defs,
		Signature: base64.StdEncoding.EncodeToString(sig),
		Timestamp: ts,
		Kid:       kid,
	}

	if err := VerifySignedDefinitions(env, jwks, map[string]struct{}{kid: {}}); err != nil {
		t.Fatalf("expected ok, got: %v", err)
	}
	if err := VerifySignedDefinitions(env, jwks, map[string]struct{}{"nope": {}}); err == nil {
		t.Fatalf("expected error for disallowed kid")
	}
}

func TestVerifySignedDefinitions_BadSignature(t *testing.T) {
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}

	xBytes := pad32(priv.PublicKey.X.Bytes())
	yBytes := pad32(priv.PublicKey.Y.Bytes())
	kid := computeKid(xBytes, yBytes)

	jwk := definitions.JWK{
		Kty: "EC",
		Use: "sig",
		Alg: "ES256",
		Crv: "P-256",
		X:   base64.RawURLEncoding.EncodeToString(xBytes),
		Y:   base64.RawURLEncoding.EncodeToString(yBytes),
		Kid: kid,
	}
	jwks := &definitions.JWKSet{Keys: []definitions.JWK{jwk}}

	defs := []byte(`[]`)
	ts := int64(1730000000)
	payload := string(defs) + "|" + strconv.FormatInt(ts, 10)
	sig, err := ecdsa.SignASN1(rand.Reader, priv, sha256Bytes(payload))
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	if len(sig) > 0 {
		sig[0] ^= 0xff
	}

	env := &definitions.SignedDefinitionsResponse{
		Defs:      defs,
		Signature: base64.StdEncoding.EncodeToString(sig),
		Timestamp: ts,
		Kid:       kid,
	}

	if err := VerifySignedDefinitions(env, jwks, nil); err == nil {
		t.Fatalf("expected invalid signature error")
	}
}

func pad32(b []byte) []byte {
	if len(b) >= 32 {
		return b
	}
	out := make([]byte, 32)
	copy(out[32-len(b):], b)
	return out
}

func computeKid(xBytes, yBytes []byte) string {
	h := sha1.Sum(append(append([]byte{}, xBytes...), yBytes...))
	return strings.ToUpper(hex.EncodeToString(h[:])) + "ES256"
}

func sha256Bytes(s string) []byte {
	h := sha256.Sum256([]byte(s))
	return h[:]
}
