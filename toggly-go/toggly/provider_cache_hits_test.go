package toggly

import (
	"context"
	"net/http"
	"net/http/httptest"
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
