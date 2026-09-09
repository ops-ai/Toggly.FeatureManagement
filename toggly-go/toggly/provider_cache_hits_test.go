package toggly

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/definitions"
	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/snapshot"
)

type countingCacheRecorder struct {
	mu     sync.Mutex
	hits   int32
	misses int32
}

func (r *countingCacheRecorder) RecordDefinitionCacheHit() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.hits++
}

func (r *countingCacheRecorder) RecordDefinitionCacheMiss() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.misses++
}

func (r *countingCacheRecorder) snapshot() (hits, misses int32) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.hits, r.misses
}

func TestProvider_Refresh_304IsHit(t *testing.T) {
	var calls int32
	defsJSON := `[{"featureKey":"f1","filters":[{"name":"AlwaysOn","parameters":{}}],"metrics":[],"securedFeature":false,"clientSdkEnabled":true,"requirementType":"Any"}]`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&calls, 1)
		if n == 1 {
			w.Header().Set("ETag", `"1"`)
			_, _ = w.Write([]byte(defsJSON))
			return
		}
		w.WriteHeader(http.StatusNotModified)
	}))
	defer srv.Close()

	rec := &countingCacheRecorder{}
	p := newDefinitionsProvider(Config{
		AppKey:          "app",
		Environment:     "env",
		DefinitionsURL:  srv.URL + "/",
		HTTPTimeout:     2 * time.Second,
		RefreshInterval: time.Hour,
	}, nil)
	p.hc = srv.Client()
	p.setDefinitionCacheRecorder(rec)

	if err := p.refresh(context.Background(), 2*time.Second, false); err != nil {
		t.Fatalf("refresh 1: %v", err)
	}
	if err := p.refresh(context.Background(), 2*time.Second, false); err != nil {
		t.Fatalf("refresh 2: %v", err)
	}

	hits, misses := rec.snapshot()
	if misses != 1 {
		t.Fatalf("misses = %d, want 1 (first 200)", misses)
	}
	if hits != 1 {
		t.Fatalf("hits = %d, want 1 (304)", hits)
	}
}

func TestProvider_Refresh_New200IsMiss(t *testing.T) {
	defsJSON := `[{"featureKey":"f1","filters":[{"name":"AlwaysOn","parameters":{}}],"metrics":[],"securedFeature":false,"clientSdkEnabled":true,"requirementType":"Any"}]`
	var etag atomic.Value
	etag.Store(`"1"`)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("ETag", etag.Load().(string))
		_, _ = w.Write([]byte(defsJSON))
	}))
	defer srv.Close()

	rec := &countingCacheRecorder{}
	p := newDefinitionsProvider(Config{
		AppKey:          "app",
		Environment:     "env",
		DefinitionsURL:  srv.URL + "/",
		HTTPTimeout:     2 * time.Second,
		RefreshInterval: time.Hour,
	}, nil)
	p.hc = srv.Client()
	p.setDefinitionCacheRecorder(rec)

	if err := p.refresh(context.Background(), 2*time.Second, false); err != nil {
		t.Fatal(err)
	}
	etag.Store(`"2"`)
	if err := p.refresh(context.Background(), 2*time.Second, false); err != nil {
		t.Fatal(err)
	}

	hits, misses := rec.snapshot()
	if misses != 2 || hits != 0 {
		t.Fatalf("hits=%d misses=%d, want 0 hits / 2 misses", hits, misses)
	}
}

func TestProvider_ShouldSkipRefresh_CountsHit(t *testing.T) {
	rec := &countingCacheRecorder{}
	p := newDefinitionsProvider(Config{
		AppKey:          "app",
		Environment:     "env",
		DefinitionsURL:  "http://example.invalid/",
		HTTPTimeout:     time.Second,
		RefreshInterval: time.Hour,
	}, nil)
	p.setDefinitionCacheRecorder(rec)
	p.liveMu.Lock()
	p.liveConnected = true
	p.lastFallback = time.Now()
	p.liveMu.Unlock()

	if !p.shouldSkipRefresh() {
		t.Fatal("expected skip")
	}
	p.recordDefinitionCacheHit()
	hits, misses := rec.snapshot()
	if hits != 1 || misses != 0 {
		t.Fatalf("hits=%d misses=%d", hits, misses)
	}
}

func TestProvider_ConcurrentRefresh_DoesNotCount(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-release
		w.Header().Set("ETag", `"1"`)
		_, _ = w.Write([]byte(`[{"featureKey":"f1","filters":[{"name":"AlwaysOn","parameters":{}}],"metrics":[],"securedFeature":false,"clientSdkEnabled":true,"requirementType":"Any"}]`))
	}))
	defer srv.Close()

	rec := &countingCacheRecorder{}
	p := newDefinitionsProvider(Config{
		AppKey:          "app",
		Environment:     "env",
		DefinitionsURL:  srv.URL + "/",
		HTTPTimeout:     5 * time.Second,
		RefreshInterval: time.Hour,
	}, nil)
	p.hc = srv.Client()
	p.setDefinitionCacheRecorder(rec)

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		_ = p.refresh(context.Background(), 5*time.Second, false)
	}()
	<-started
	// Concurrent attempt while first is in flight — must not count.
	_ = p.refresh(context.Background(), time.Second, false)
	close(release)
	wg.Wait()

	hits, misses := rec.snapshot()
	if hits != 0 || misses != 1 {
		t.Fatalf("hits=%d misses=%d, want only the in-flight miss", hits, misses)
	}
}

func TestProvider_WSForcedRefresh_MissOnNewRev(t *testing.T) {
	// Live WS connected with recent fallback would skip scheduled polls, but
	// forced (fromWebSocket) refresh must still fetch and count miss.
	defsJSON := `[{"featureKey":"f1","filters":[{"name":"AlwaysOn","parameters":{}}],"metrics":[],"securedFeature":false,"clientSdkEnabled":true,"requirementType":"Any"}]`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("ETag", `"ws-1"`)
		_, _ = w.Write([]byte(defsJSON))
	}))
	defer srv.Close()

	rec := &countingCacheRecorder{}
	p := newDefinitionsProvider(Config{
		AppKey:          "app",
		Environment:     "env",
		DefinitionsURL:  srv.URL + "/",
		HTTPTimeout:     2 * time.Second,
		RefreshInterval: time.Hour,
	}, nil)
	p.hc = srv.Client()
	p.setDefinitionCacheRecorder(rec)
	p.liveMu.Lock()
	p.liveConnected = true
	p.lastFallback = time.Now()
	p.liveMu.Unlock()

	if !p.shouldSkipRefresh() {
		t.Fatal("scheduled poll should skip while WS live")
	}
	if err := p.refresh(context.Background(), 2*time.Second, true); err != nil {
		t.Fatal(err)
	}
	hits, misses := rec.snapshot()
	if misses != 1 || hits != 0 {
		t.Fatalf("WS force: hits=%d misses=%d, want miss", hits, misses)
	}
}

func TestProvider_NetworkError_CountsHit(t *testing.T) {
	rec := &countingCacheRecorder{}
	p := newDefinitionsProvider(Config{
		AppKey:          "app",
		Environment:     "env",
		DefinitionsURL:  "http://127.0.0.1:1/",
		HTTPTimeout:     200 * time.Millisecond,
		RefreshInterval: time.Hour,
	}, nil)
	p.setDefinitionCacheRecorder(rec)

	err := p.refresh(context.Background(), 200*time.Millisecond, false)
	if err == nil {
		t.Fatal("expected network error")
	}
	hits, misses := rec.snapshot()
	if hits != 1 || misses != 0 {
		t.Fatalf("hits=%d misses=%d, want hit on network error", hits, misses)
	}
}

type memorySnap struct {
	defs snapshot.DefinitionsSnapshot
}

func (m *memorySnap) LoadDefinitions(ctx context.Context) (*snapshot.DefinitionsSnapshot, error) {
	cp := m.defs
	return &cp, nil
}
func (m *memorySnap) SaveDefinitions(ctx context.Context, defs snapshot.DefinitionsSnapshot) error {
	m.defs = defs
	return nil
}
func (m *memorySnap) Clear(ctx context.Context) error                         { return nil }
func (m *memorySnap) LoadJWKS(ctx context.Context) (*snapshot.JWKSnap, error) { return nil, nil }
func (m *memorySnap) SaveJWKS(ctx context.Context, j snapshot.JWKSnap) error  { return nil }

func TestProvider_SnapshotBeforeNetwork_CountsHit(t *testing.T) {
	// Snapshot + network in one refresh() must emit exactly one outcome (304 → hit).
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotModified)
	}))
	defer srv.Close()

	snap := &memorySnap{defs: snapshot.DefinitionsSnapshot{
		Defs: []definitions.FeatureDefinitionModel{{
			FeatureKey:      "f1",
			Filters:         []definitions.FeatureFilter{{Name: "AlwaysOn"}},
			RequirementType: definitions.RequirementAny,
		}},
		ETag: `"snap"`,
	}}

	rec := &countingCacheRecorder{}
	p := newDefinitionsProvider(Config{
		AppKey:          "app",
		Environment:     "env",
		DefinitionsURL:  srv.URL + "/",
		HTTPTimeout:     2 * time.Second,
		RefreshInterval: time.Hour,
	}, snap)
	p.hc = srv.Client()
	p.setDefinitionCacheRecorder(rec)

	if err := p.refresh(context.Background(), 2*time.Second, false); err != nil {
		t.Fatal(err)
	}
	hits, misses := rec.snapshot()
	if hits != 1 || misses != 0 {
		t.Fatalf("hits=%d misses=%d, want exactly 1 hit / 0 misses for one refresh()", hits, misses)
	}
	if _, ok := p.get("f1"); !ok {
		t.Fatal("expected snapshot defs loaded")
	}
}

func TestProvider_SignedEqualTimestamp_IsHit(t *testing.T) {
	const ts int64 = 1_700_000_000
	body := `{"defs":[{"featureKey":"f1","filters":[{"name":"AlwaysOn","parameters":{}}],"metrics":[],"securedFeature":false,"clientSdkEnabled":true,"requirementType":"Any"}],"signature":"unused","timestamp":1700000000,"kid":"k1"}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("ETag", `"replay"`)
		_, _ = w.Write([]byte(body))
	}))
	defer srv.Close()

	rec := &countingCacheRecorder{}
	p := newDefinitionsProvider(Config{
		AppKey:               "app",
		Environment:          "env",
		DefinitionsURL:       srv.URL + "/",
		HTTPTimeout:          2 * time.Second,
		RefreshInterval:      time.Hour,
		UseSignedDefinitions: true,
	}, nil)
	p.hc = srv.Client()
	p.setDefinitionCacheRecorder(rec)
	p.mu.Lock()
	p.lastTS = ts
	p.etag = `"prior"`
	p.mu.Unlock()

	if err := p.refresh(context.Background(), 2*time.Second, false); err != nil {
		t.Fatal(err)
	}
	hits, misses := rec.snapshot()
	if hits != 1 || misses != 0 {
		t.Fatalf("equal signed TS: hits=%d misses=%d, want hit", hits, misses)
	}
}

func TestProvider_EvaluatedVariantsEqualTimestamp_IsHit(t *testing.T) {
	const ts int64 = 1_700_000_000
	body := `{"defs":{"f1":{"enabled":true,"variant":"A","configurationValue":null}},"signature":"unused","timestamp":1700000000,"kid":"k1"}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("ETag", `"replay"`)
		_, _ = w.Write([]byte(body))
	}))
	defer srv.Close()

	rec := &countingCacheRecorder{}
	p := newDefinitionsProvider(Config{
		AppKey:          "app",
		Environment:     "env",
		DefinitionsURL:  srv.URL + "/",
		HTTPTimeout:     2 * time.Second,
		RefreshInterval: time.Hour,
		EnableVariants:  true,
	}, nil)
	p.hc = srv.Client()
	p.setDefinitionCacheRecorder(rec)
	p.mu.Lock()
	p.variantLastTS = ts
	p.variantEtag = `"prior"`
	p.mu.Unlock()

	if err := p.refresh(context.Background(), 2*time.Second, false); err != nil {
		t.Fatal(err)
	}
	hits, misses := rec.snapshot()
	if hits != 1 || misses != 0 {
		t.Fatalf("equal variant TS: hits=%d misses=%d, want hit", hits, misses)
	}
}

func TestProvider_Signed_304IsHit(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotModified)
	}))
	defer srv.Close()

	rec := &countingCacheRecorder{}
	p := signedProvider(t, srv, rec)
	p.mu.Lock()
	p.etag = `"1"`
	p.mu.Unlock()

	if err := p.refresh(context.Background(), 2*time.Second, false); err != nil {
		t.Fatal(err)
	}
	hits, misses := rec.snapshot()
	if hits != 1 || misses != 0 {
		t.Fatalf("signed 304: hits=%d misses=%d", hits, misses)
	}
}

func TestProvider_Signed_MatchingETagIsHit(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("ETag", `W/"abc"`)
		_, _ = w.Write([]byte(`{"defs":[],"signature":"x","timestamp":99,"kid":"k"}`))
	}))
	defer srv.Close()

	rec := &countingCacheRecorder{}
	p := signedProvider(t, srv, rec)
	p.mu.Lock()
	p.etag = `"abc"`
	p.mu.Unlock()

	if err := p.refresh(context.Background(), 2*time.Second, false); err != nil {
		t.Fatal(err)
	}
	hits, misses := rec.snapshot()
	if hits != 1 || misses != 0 {
		t.Fatalf("signed etag match: hits=%d misses=%d", hits, misses)
	}
}

func TestProvider_Signed_HTTPErrorIsHit(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	defer srv.Close()

	rec := &countingCacheRecorder{}
	p := signedProvider(t, srv, rec)
	err := p.refresh(context.Background(), 2*time.Second, false)
	if err == nil {
		t.Fatal("expected HTTP error")
	}
	hits, misses := rec.snapshot()
	if hits != 1 || misses != 0 {
		t.Fatalf("signed HTTP error: hits=%d misses=%d", hits, misses)
	}
}

func TestProvider_Signed_DecodeErrorIsHit(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("ETag", `"new"`)
		_, _ = w.Write([]byte(`not-json`))
	}))
	defer srv.Close()

	rec := &countingCacheRecorder{}
	p := signedProvider(t, srv, rec)
	err := p.refresh(context.Background(), 2*time.Second, false)
	if err == nil {
		t.Fatal("expected decode error")
	}
	hits, misses := rec.snapshot()
	if hits != 1 || misses != 0 {
		t.Fatalf("signed decode error: hits=%d misses=%d", hits, misses)
	}
}

func TestProvider_Signed_JWKSFetchErrorIsHit(t *testing.T) {
	const ts int64 = 1_700_000_100
	body := `{"defs":[{"featureKey":"f1","filters":[{"name":"AlwaysOn","parameters":{}}],"metrics":[],"securedFeature":false,"clientSdkEnabled":true,"requirementType":"Any"}],"signature":"dGVzdA==","timestamp":1700000100,"kid":"k1"}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "jwks") {
			http.Error(w, "nope", http.StatusBadGateway)
			return
		}
		w.Header().Set("ETag", `"new"`)
		_, _ = w.Write([]byte(body))
	}))
	defer srv.Close()

	rec := &countingCacheRecorder{}
	p := signedProvider(t, srv, rec)
	p.mu.Lock()
	p.lastTS = ts - 10
	p.mu.Unlock()

	err := p.refresh(context.Background(), 2*time.Second, false)
	if err == nil {
		t.Fatal("expected JWKS error")
	}
	hits, misses := rec.snapshot()
	if hits != 1 || misses != 0 {
		t.Fatalf("signed JWKS error: hits=%d misses=%d", hits, misses)
	}
}

func TestProvider_Signed_VerifyErrorIsHit(t *testing.T) {
	const ts int64 = 1_700_000_100
	body := `{"defs":[{"featureKey":"f1","filters":[{"name":"AlwaysOn","parameters":{}}],"metrics":[],"securedFeature":false,"clientSdkEnabled":true,"requirementType":"Any"}],"signature":"AAAA","timestamp":1700000100,"kid":"missing"}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("ETag", `"new"`)
		_, _ = w.Write([]byte(body))
	}))
	defer srv.Close()

	rec := &countingCacheRecorder{}
	p := signedProvider(t, srv, rec)
	seedEmptyJWKS(p)
	p.mu.Lock()
	p.lastTS = ts - 10
	p.mu.Unlock()

	err := p.refresh(context.Background(), 2*time.Second, false)
	if err == nil {
		t.Fatal("expected verify error")
	}
	hits, misses := rec.snapshot()
	if hits != 1 || misses != 0 {
		t.Fatalf("signed verify error: hits=%d misses=%d", hits, misses)
	}
}

func TestProvider_Signed_NewRevisionIsMiss(t *testing.T) {
	priv, jwk, kid := mustTestKey(t)
	rawDefs := []byte(`[{"featureKey":"f1","filters":[{"name":"AlwaysOn","parameters":{}}],"metrics":[],"securedFeature":false,"clientSdkEnabled":true,"requirementType":"Any"}]`)
	const ts int64 = 1_700_000_200
	sig := mustSignDefs(t, priv, rawDefs, ts)
	env, err := json.Marshal(map[string]any{
		"defs":      json.RawMessage(rawDefs),
		"signature": sig,
		"timestamp": ts,
		"kid":       kid,
	})
	if err != nil {
		t.Fatal(err)
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// No ETag → covers storeSignedRevisionMeta else-path for empty etag.
		_, _ = w.Write(env)
	}))
	defer srv.Close()

	rec := &countingCacheRecorder{}
	snap := &memorySnap{}
	p := signedProvider(t, srv, rec)
	p.snap = snap
	seedJWKS(p, &definitions.JWKSet{Keys: []definitions.JWK{jwk}})
	p.mu.Lock()
	p.lastTS = ts - 50
	p.mu.Unlock()

	if err := p.refresh(context.Background(), 2*time.Second, false); err != nil {
		t.Fatal(err)
	}
	hits, misses := rec.snapshot()
	if hits != 0 || misses != 1 {
		t.Fatalf("signed miss: hits=%d misses=%d", hits, misses)
	}
	if _, ok := p.get("f1"); !ok {
		t.Fatal("expected f1 applied")
	}
	if snap.defs.Timestamp != ts {
		t.Fatalf("snapshot ts = %d, want %d", snap.defs.Timestamp, ts)
	}
}

func TestProvider_Signed_NewRevisionWithETagIsMiss(t *testing.T) {
	priv, jwk, kid := mustTestKey(t)
	rawDefs := []byte(`[{"featureKey":"f2","filters":[{"name":"AlwaysOn","parameters":{}}],"metrics":[],"securedFeature":false,"clientSdkEnabled":true,"requirementType":"Any"}]`)
	const ts int64 = 1_700_000_250
	sig := mustSignDefs(t, priv, rawDefs, ts)
	env, err := json.Marshal(map[string]any{
		"defs":      json.RawMessage(rawDefs),
		"signature": sig,
		"timestamp": ts,
		"kid":       kid,
	})
	if err != nil {
		t.Fatal(err)
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("ETag", `"rev-2"`)
		_, _ = w.Write(env)
	}))
	defer srv.Close()

	rec := &countingCacheRecorder{}
	p := signedProvider(t, srv, rec)
	seedJWKS(p, &definitions.JWKSet{Keys: []definitions.JWK{jwk}})

	if err := p.refresh(context.Background(), 2*time.Second, false); err != nil {
		t.Fatal(err)
	}
	hits, misses := rec.snapshot()
	if hits != 0 || misses != 1 {
		t.Fatalf("signed etag miss: hits=%d misses=%d", hits, misses)
	}
	p.mu.RLock()
	gotETag, gotTS := p.etag, p.lastTS
	p.mu.RUnlock()
	if gotETag != `"rev-2"` || gotTS != ts {
		t.Fatalf("meta etag=%q ts=%d", gotETag, gotTS)
	}
}

func TestProvider_Unsigned_MissWithoutETag(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`[{"featureKey":"f1","filters":[{"name":"AlwaysOn","parameters":{}}],"metrics":[],"securedFeature":false,"clientSdkEnabled":true,"requirementType":"Any"}]`))
	}))
	defer srv.Close()

	rec := &countingCacheRecorder{}
	p := newDefinitionsProvider(Config{
		AppKey:          "app",
		Environment:     "env",
		DefinitionsURL:  srv.URL + "/",
		HTTPTimeout:     2 * time.Second,
		RefreshInterval: time.Hour,
	}, nil)
	p.hc = srv.Client()
	p.setDefinitionCacheRecorder(rec)

	if err := p.refresh(context.Background(), 2*time.Second, false); err != nil {
		t.Fatal(err)
	}
	hits, misses := rec.snapshot()
	if hits != 0 || misses != 1 {
		t.Fatalf("unsigned no-etag miss: hits=%d misses=%d", hits, misses)
	}
}

func TestProvider_Unsigned_MatchingETagIsHit(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("ETag", `"same"`)
		_, _ = w.Write([]byte(`[{"featureKey":"f1","filters":[{"name":"AlwaysOn","parameters":{}}],"metrics":[],"securedFeature":false,"clientSdkEnabled":true,"requirementType":"Any"}]`))
	}))
	defer srv.Close()

	rec := &countingCacheRecorder{}
	p := newDefinitionsProvider(Config{
		AppKey:          "app",
		Environment:     "env",
		DefinitionsURL:  srv.URL + "/",
		HTTPTimeout:     2 * time.Second,
		RefreshInterval: time.Hour,
	}, nil)
	p.hc = srv.Client()
	p.setDefinitionCacheRecorder(rec)
	p.mu.Lock()
	p.etag = `"same"`
	p.mu.Unlock()

	if err := p.refresh(context.Background(), 2*time.Second, false); err != nil {
		t.Fatal(err)
	}
	hits, misses := rec.snapshot()
	if hits != 1 || misses != 0 {
		t.Fatalf("unsigned etag match: hits=%d misses=%d", hits, misses)
	}
}

func TestProvider_Unsigned_HTTPErrorIsHit(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "nope", http.StatusBadRequest)
	}))
	defer srv.Close()

	rec := &countingCacheRecorder{}
	p := newDefinitionsProvider(Config{
		AppKey:          "app",
		Environment:     "env",
		DefinitionsURL:  srv.URL + "/",
		HTTPTimeout:     2 * time.Second,
		RefreshInterval: time.Hour,
	}, nil)
	p.hc = srv.Client()
	p.setDefinitionCacheRecorder(rec)

	err := p.refresh(context.Background(), 2*time.Second, false)
	if err == nil {
		t.Fatal("expected HTTP error")
	}
	hits, misses := rec.snapshot()
	if hits != 1 || misses != 0 {
		t.Fatalf("unsigned HTTP error: hits=%d misses=%d", hits, misses)
	}
}

func TestProvider_Variants_MatchingETagIsHit(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("ETag", `"v1"`)
		_, _ = w.Write([]byte(`{"defs":{"f1":{"enabled":true,"variant":"A","configurationValue":null}},"signature":"","timestamp":99,"kid":""}`))
	}))
	defer srv.Close()

	rec := &countingCacheRecorder{}
	p := variantsProvider(t, srv, rec)
	p.mu.Lock()
	p.variantEtag = `"v1"`
	p.mu.Unlock()

	if err := p.refresh(context.Background(), 2*time.Second, false); err != nil {
		t.Fatal(err)
	}
	hits, misses := rec.snapshot()
	if hits != 1 || misses != 0 {
		t.Fatalf("variants etag match: hits=%d misses=%d", hits, misses)
	}
}

func TestProvider_Variants_HTTPErrorIsHit(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "fail", http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	rec := &countingCacheRecorder{}
	p := variantsProvider(t, srv, rec)
	err := p.refresh(context.Background(), 2*time.Second, false)
	if err == nil {
		t.Fatal("expected HTTP error")
	}
	hits, misses := rec.snapshot()
	if hits != 1 || misses != 0 {
		t.Fatalf("variants HTTP error: hits=%d misses=%d", hits, misses)
	}
}

func TestProvider_Variants_NewRevisionIsMiss(t *testing.T) {
	body := `{"defs":{"f1":{"enabled":true,"variant":"A","configurationValue":null}},"signature":"","timestamp":1700000300,"kid":""}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Empty etag still stores the new variant timestamp.
		_, _ = w.Write([]byte(body))
	}))
	defer srv.Close()

	rec := &countingCacheRecorder{}
	snap := &memorySnap{}
	p := variantsProvider(t, srv, rec)
	p.snap = snap

	if err := p.refresh(context.Background(), 2*time.Second, false); err != nil {
		t.Fatal(err)
	}
	hits, misses := rec.snapshot()
	if hits != 0 || misses != 1 {
		t.Fatalf("variants miss: hits=%d misses=%d", hits, misses)
	}
	if p.getVariant("f1") == nil {
		t.Fatal("expected variant applied")
	}
	if snap.defs.VariantTimestamp != 1_700_000_300 {
		t.Fatalf("variant snapshot ts = %d", snap.defs.VariantTimestamp)
	}
}

func TestProvider_Variants_DecodeErrorIsHit(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("ETag", `"x"`)
		_, _ = w.Write([]byte(`{bad`))
	}))
	defer srv.Close()

	rec := &countingCacheRecorder{}
	p := variantsProvider(t, srv, rec)
	err := p.refresh(context.Background(), 2*time.Second, false)
	if err == nil {
		t.Fatal("expected decode error")
	}
	hits, misses := rec.snapshot()
	if hits != 1 || misses != 0 {
		t.Fatalf("variants decode error: hits=%d misses=%d", hits, misses)
	}
}

func TestProvider_Variants_SignedVerifyErrorIsHit(t *testing.T) {
	body := `{"defs":{"f1":{"enabled":true,"variant":"A","configurationValue":null}},"signature":"AAAA","timestamp":1700000400,"kid":"missing"}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("ETag", `"v2"`)
		_, _ = w.Write([]byte(body))
	}))
	defer srv.Close()

	rec := &countingCacheRecorder{}
	p := newDefinitionsProvider(Config{
		AppKey:               "app",
		Environment:          "env",
		DefinitionsURL:       srv.URL + "/",
		HTTPTimeout:          2 * time.Second,
		RefreshInterval:      time.Hour,
		EnableVariants:       true,
		UseSignedDefinitions: true,
	}, nil)
	p.hc = srv.Client()
	p.setDefinitionCacheRecorder(rec)
	seedEmptyJWKS(p)

	err := p.refresh(context.Background(), 2*time.Second, false)
	if err == nil {
		t.Fatal("expected verify error")
	}
	hits, misses := rec.snapshot()
	if hits != 1 || misses != 0 {
		t.Fatalf("variants signed verify: hits=%d misses=%d", hits, misses)
	}
}

func TestNormalizeETag_WeakTag(t *testing.T) {
	if !etagsMatch(`W/"1"`, `"1"`) {
		t.Fatal("weak etag should match strong")
	}
	if normalizeETag(` w/"xyz" `) != "xyz" {
		t.Fatalf("normalize weak = %q", normalizeETag(` w/"xyz" `))
	}
}

func signedProvider(t *testing.T, srv *httptest.Server, rec *countingCacheRecorder) *definitionsProvider {
	t.Helper()
	p := newDefinitionsProvider(Config{
		AppKey:               "app",
		Environment:          "env",
		DefinitionsURL:       srv.URL + "/",
		HTTPTimeout:          2 * time.Second,
		RefreshInterval:      time.Hour,
		UseSignedDefinitions: true,
	}, nil)
	p.hc = srv.Client()
	p.setDefinitionCacheRecorder(rec)
	return p
}

func variantsProvider(t *testing.T, srv *httptest.Server, rec *countingCacheRecorder) *definitionsProvider {
	t.Helper()
	p := newDefinitionsProvider(Config{
		AppKey:          "app",
		Environment:     "env",
		DefinitionsURL:  srv.URL + "/",
		HTTPTimeout:     2 * time.Second,
		RefreshInterval: time.Hour,
		EnableVariants:  true,
	}, nil)
	p.hc = srv.Client()
	p.setDefinitionCacheRecorder(rec)
	return p
}

func seedEmptyJWKS(p *definitionsProvider) {
	seedJWKS(p, &definitions.JWKSet{Keys: nil})
}

func seedJWKS(p *definitionsProvider, set *definitions.JWKSet) {
	p.jwksMu.Lock()
	p.jwks = set
	p.jwksExpiry = time.Now().Add(time.Hour)
	p.jwksMu.Unlock()
}

func mustTestKey(t *testing.T) (*ecdsa.PrivateKey, definitions.JWK, string) {
	t.Helper()
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	xBytes := pad32Cache(priv.X.Bytes())
	yBytes := pad32Cache(priv.Y.Bytes())
	kid := computeKidCache(xBytes, yBytes)
	jwk := definitions.JWK{
		Kty: "EC", Use: "sig", Alg: "ES256", Crv: "P-256",
		X:   base64.RawURLEncoding.EncodeToString(xBytes),
		Y:   base64.RawURLEncoding.EncodeToString(yBytes),
		Kid: kid,
	}
	return priv, jwk, kid
}

func mustSignDefs(t *testing.T, priv *ecdsa.PrivateKey, defs []byte, ts int64) string {
	t.Helper()
	payload := string(defs) + "|" + strconv.FormatInt(ts, 10)
	first := sha256.Sum256([]byte(payload))
	second := sha256.Sum256(first[:])
	r, s, err := ecdsa.Sign(rand.Reader, priv, second[:])
	if err != nil {
		t.Fatal(err)
	}
	sig := append(pad32Cache(r.Bytes()), pad32Cache(s.Bytes())...)
	return base64.StdEncoding.EncodeToString(sig)
}

func pad32Cache(b []byte) []byte {
	if len(b) >= 32 {
		return b
	}
	out := make([]byte, 32)
	copy(out[32-len(b):], b)
	return out
}

func computeKidCache(xBytes, yBytes []byte) string {
	h := sha1.Sum(append(append([]byte{}, xBytes...), yBytes...))
	return strings.ToUpper(hex.EncodeToString(h[:])) + "ES256"
}
