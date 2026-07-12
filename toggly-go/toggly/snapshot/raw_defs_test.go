package snapshot

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/crypto"
	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/definitions"
)

func TestMemoryProvider_RawDefsRoundTripAndVerify(t *testing.T) {
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	xBytes := pad32(priv.X.Bytes())
	yBytes := pad32(priv.Y.Bytes())
	kid := computeKid(xBytes, yBytes)

	jwks := &definitions.JWKSet{Keys: []definitions.JWK{{
		Kty: "EC", Use: "sig", Alg: "ES256", Crv: "P-256",
		X:   base64.RawURLEncoding.EncodeToString(xBytes),
		Y:   base64.RawURLEncoding.EncodeToString(yBytes),
		Kid: kid,
	}}}

	rawDefs := json.RawMessage(`[{"featureKey":"demo","filters":[{"name":"AlwaysOn","parameters":{}}],"metrics":[],"securedFeature":false,"clientSdkEnabled":true,"requirementType":"Any"}]`)
	ts := int64(1730000000)
	payload := string(rawDefs) + "|" + strconv.FormatInt(ts, 10)
	sig, err := signP1363(priv, doubleHash(payload))
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	var defs []definitions.FeatureDefinitionModel
	if err := json.Unmarshal(rawDefs, &defs); err != nil {
		t.Fatalf("unmarshal defs: %v", err)
	}

	provider := NewMemoryProvider()
	ctx := context.Background()
	input := DefinitionsSnapshot{
		Defs:      defs,
		Signature: base64.StdEncoding.EncodeToString(sig),
		Kid:       kid,
		Timestamp: ts,
		RawDefs:   rawDefs,
		ETag:      `"rev-1"`,
	}
	if err := provider.SaveDefinitions(ctx, input); err != nil {
		t.Fatalf("save: %v", err)
	}

	loaded, err := provider.LoadDefinitions(ctx)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if loaded == nil {
		t.Fatal("expected snapshot")
	}
	if !bytes.Equal(loaded.RawDefs, rawDefs) {
		t.Fatalf("raw defs mismatch:\n got %s\nwant %s", loaded.RawDefs, rawDefs)
	}
	if loaded.ETag != `"rev-1"` {
		t.Fatalf("etag = %q", loaded.ETag)
	}

	env := &definitions.SignedDefinitionsResponse{
		Defs:      loaded.RawDefs,
		Signature: loaded.Signature,
		Kid:       loaded.Kid,
		Timestamp: loaded.Timestamp,
	}
	if err := crypto.VerifySignedDefinitions(env, jwks, nil); err != nil {
		t.Fatalf("verify after round-trip: %v", err)
	}
}

func TestMemoryProvider_Clear(t *testing.T) {
	provider := NewMemoryProvider()
	ctx := context.Background()

	if err := provider.SaveDefinitions(ctx, DefinitionsSnapshot{
		Defs: []definitions.FeatureDefinitionModel{{FeatureKey: "f1"}},
	}); err != nil {
		t.Fatalf("save defs: %v", err)
	}
	if err := provider.SaveJWKS(ctx, JWKSnap{
		Set:    definitions.JWKSet{},
		Expiry: time.Now().Add(time.Hour),
	}); err != nil {
		t.Fatalf("save jwks: %v", err)
	}

	if err := provider.Clear(ctx); err != nil {
		t.Fatalf("clear: %v", err)
	}

	defs, err := provider.LoadDefinitions(ctx)
	if err != nil {
		t.Fatalf("load defs: %v", err)
	}
	if defs != nil {
		t.Fatalf("expected nil defs after clear, got %+v", defs)
	}
	jwks, err := provider.LoadJWKS(ctx)
	if err != nil {
		t.Fatalf("load jwks: %v", err)
	}
	if jwks != nil {
		t.Fatalf("expected nil jwks after clear, got %+v", jwks)
	}
}

func TestFileProvider_RawDefsAndClear(t *testing.T) {
	dir := t.TempDir()
	provider := NewFileProvider(dir)
	ctx := context.Background()

	raw := json.RawMessage(`[{"featureKey":"a"}]`)
	input := DefinitionsSnapshot{
		Defs:      []definitions.FeatureDefinitionModel{{FeatureKey: "a"}},
		Signature: "sig",
		Kid:       "kid",
		Timestamp: 1,
		RawDefs:   raw,
		ETag:      "e1",
	}
	if err := provider.SaveDefinitions(ctx, input); err != nil {
		t.Fatalf("save: %v", err)
	}
	loaded, err := provider.LoadDefinitions(ctx)
	if err != nil || loaded == nil {
		t.Fatalf("load: %v %+v", err, loaded)
	}
	if !bytes.Equal(loaded.RawDefs, raw) {
		t.Fatalf("raw defs lost")
	}

	if err := provider.SaveJWKS(ctx, JWKSnap{Expiry: time.Now().Add(time.Hour)}); err != nil {
		t.Fatalf("save jwks: %v", err)
	}
	if err := provider.Clear(ctx); err != nil {
		t.Fatalf("clear: %v", err)
	}
	loaded, err = provider.LoadDefinitions(ctx)
	if err != nil {
		t.Fatalf("load after clear: %v", err)
	}
	if loaded != nil {
		t.Fatalf("expected nil after clear")
	}
}

func TestSQLiteProvider_RawDefsAndClear(t *testing.T) {
	db := newTestSQLiteDB(t)
	defer func() { _ = db.Close() }()

	provider := NewSQLiteProvider(SQLiteOptions{DB: db})
	ctx := context.Background()

	raw := json.RawMessage(`[{"featureKey":"sqlite-raw"}]`)
	input := DefinitionsSnapshot{
		Defs:      []definitions.FeatureDefinitionModel{{FeatureKey: "sqlite-raw"}},
		Signature: "sig",
		Kid:       "kid",
		Timestamp: 42,
		RawDefs:   raw,
		ETag:      "etag-sq",
	}
	if err := provider.SaveDefinitions(ctx, input); err != nil {
		t.Fatalf("save: %v", err)
	}
	loaded, err := provider.LoadDefinitions(ctx)
	if err != nil || loaded == nil {
		t.Fatalf("load: %v %+v", err, loaded)
	}
	if !bytes.Equal(loaded.RawDefs, raw) {
		t.Fatalf("raw defs mismatch: %s", loaded.RawDefs)
	}
	if loaded.ETag != "etag-sq" {
		t.Fatalf("etag = %q", loaded.ETag)
	}

	if err := provider.SaveJWKS(ctx, JWKSnap{
		Set:    definitions.JWKSet{Keys: []definitions.JWK{{Kid: "k"}}},
		Expiry: time.Now().Add(time.Hour),
	}); err != nil {
		t.Fatalf("save jwks: %v", err)
	}
	if err := provider.Clear(ctx); err != nil {
		t.Fatalf("clear: %v", err)
	}
	loaded, err = provider.LoadDefinitions(ctx)
	if err != nil {
		t.Fatalf("load after clear: %v", err)
	}
	if loaded != nil {
		t.Fatalf("expected nil defs after clear")
	}
	jwks, err := provider.LoadJWKS(ctx)
	if err != nil {
		t.Fatalf("load jwks after clear: %v", err)
	}
	if jwks != nil {
		t.Fatalf("expected nil jwks after clear")
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

func doubleHash(s string) []byte {
	first := sha256.Sum256([]byte(s))
	second := sha256.Sum256(first[:])
	return second[:]
}

func signP1363(priv *ecdsa.PrivateKey, hash []byte) ([]byte, error) {
	r, s, err := ecdsa.Sign(rand.Reader, priv, hash)
	if err != nil {
		return nil, err
	}
	return append(pad32(r.Bytes()), pad32(s.Bytes())...), nil
}
