package toggly

import (
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/crypto"
	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/definitions"
	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/live"
	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/snapshot"
)

// definitionCacheRecorder accumulates definition-refresh cache hit/miss counts
// on the usage pipeline. Optional — nil when usage is disabled.
type definitionCacheRecorder interface {
	RecordDefinitionCacheHit()
	RecordDefinitionCacheMiss()
}

type refreshCacheOutcome int

const (
	refreshCacheMiss refreshCacheOutcome = iota // applied a new revision
	refreshCacheHit                             // served from local/cache
)

type definitionsProvider struct {
	cfg  Config
	hc   *http.Client
	snap snapshot.Provider

	mu        sync.RWMutex
	defsByKey map[string]definitions.FeatureDefinitionModel
	etag      string
	lastTS    int64
	secure    map[string]struct{}

	// Evaluated variants (evaluated-variants-signed); separate ETag / timestamp from definitions.
	variantsByKey     map[string]definitions.EvaluatedVariantDef
	variantEtag       string
	variantLastTS     int64
	variantID         string
	variantGeneration uint64

	lastErr     string
	lastErrTime *time.Time
	lastRefresh *time.Time

	jwksMu     sync.Mutex
	jwks       *definitions.JWKSet
	jwksExpiry time.Time

	liveMu           sync.Mutex
	liveCloser       io.Closer
	liveConnected    bool
	lastFallback     time.Time
	fallbackInterval time.Duration

	refreshInFlight  atomic.Bool
	pendingWSRefresh atomic.Bool

	cacheRecorder definitionCacheRecorder

	stop chan struct{}
	wg   sync.WaitGroup
}

func newDefinitionsProvider(cfg Config, snap snapshot.Provider) *definitionsProvider {
	cfg.applyDefaults()
	// Normalize into owned collections before storage or background work can run.
	groups := make([]string, 0, len(cfg.VariantGroups))
	for _, group := range cfg.VariantGroups {
		if group = strings.TrimSpace(group); group != "" {
			groups = append(groups, group)
		}
	}
	keys := make([]string, 0, len(cfg.VariantClaims))
	for key, value := range cfg.VariantClaims {
		if key != "" && value != "" {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	if len(keys) > 20 {
		keys = keys[:20]
	}
	claims := make(map[string]string, len(keys))
	for _, key := range keys {
		claims[key] = cfg.VariantClaims[key]
	}
	cfg.VariantGroups, cfg.VariantClaims = groups, claims
	return &definitionsProvider{
		cfg:              cfg,
		hc:               &http.Client{Timeout: cfg.HTTPTimeout},
		snap:             snap,
		defsByKey:        map[string]definitions.FeatureDefinitionModel{},
		secure:           map[string]struct{}{},
		variantsByKey:    map[string]definitions.EvaluatedVariantDef{},
		variantID:        cfg.VariantIdentity,
		stop:             make(chan struct{}),
		fallbackInterval: 20 * time.Minute,
	}
}

func (p *definitionsProvider) setDefinitionCacheRecorder(r definitionCacheRecorder) {
	p.cacheRecorder = r
}

func (p *definitionsProvider) recordDefinitionCacheHit() {
	if r := p.cacheRecorder; r != nil {
		r.RecordDefinitionCacheHit()
	}
}

func (p *definitionsProvider) recordDefinitionCacheMiss() {
	if r := p.cacheRecorder; r != nil {
		r.RecordDefinitionCacheMiss()
	}
}

func (p *definitionsProvider) start() {
	p.wg.Add(1)
	go func() {
		defer p.wg.Done()
		ticker := time.NewTicker(p.cfg.RefreshInterval)
		defer ticker.Stop()

		// initial refresh best-effort
		_ = p.refresh(context.Background(), p.cfg.HTTPTimeout, false)
		// best-effort live updates
		if p.cfg.EnableLiveUpdates {
			p.startLiveUpdates()
		}

		for {
			select {
			case <-p.stop:
				return
			case <-ticker.C:
				if p.shouldSkipRefresh() {
					// Skipped poll (live WS / in-memory still valid) = cache hit.
					p.recordDefinitionCacheHit()
					continue
				}
				_ = p.refresh(context.Background(), p.cfg.HTTPTimeout, false)
			}
		}
	}()
}

func (p *definitionsProvider) shouldSkipRefresh() bool {
	p.liveMu.Lock()
	connected := p.liveConnected
	lastFallback := p.lastFallback
	fallbackInterval := p.fallbackInterval
	p.liveMu.Unlock()

	if !connected {
		return false
	}
	if time.Since(lastFallback) < fallbackInterval {
		return true
	}
	p.liveMu.Lock()
	p.lastFallback = time.Now()
	p.liveMu.Unlock()
	return false
}

func (p *definitionsProvider) close() {
	close(p.stop)
	p.wg.Wait()
	p.liveMu.Lock()
	if p.liveCloser != nil {
		_ = p.liveCloser.Close()
		p.liveCloser = nil
	}
	p.liveMu.Unlock()
}

func (p *definitionsProvider) startLiveUpdates() {
	p.liveMu.Lock()
	if p.liveCloser != nil {
		p.liveMu.Unlock()
		return
	}
	p.liveMu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	closer, err := live.Start(ctx, p.cfg.DefinitionsURL, p.cfg.AppKey, p.cfg.Environment, p.hc, p.getDefinitionsRevision(), func(forceJWKSRefresh bool) {
		if forceJWKSRefresh {
			p.clearJWKS()
		}
		// WS-forced refresh must not be suppressed by scheduled poll skip.
		_ = p.refresh(context.Background(), 10*time.Second, true)
	})
	if err != nil {
		return
	}
	p.liveMu.Lock()
	p.liveCloser = closer
	p.liveConnected = true
	p.lastFallback = time.Now()
	p.liveMu.Unlock()
}

func (p *definitionsProvider) get(featureKey string) (definitions.FeatureDefinitionModel, bool) {
	p.mu.RLock()
	defer p.mu.RUnlock()
	def, ok := p.defsByKey[featureKey]
	return def, ok
}

func (p *definitionsProvider) isSecure(featureKey string) bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	_, ok := p.secure[featureKey]
	return ok
}

func (p *definitionsProvider) setVariantIdentity(identity string) {
	p.mu.Lock()
	if p.variantID != identity {
		p.variantID = identity
		p.variantGeneration++
		p.variantEtag = ""
		p.variantLastTS = 0
		if p.cfg.EnableVariants {
			p.variantsByKey = map[string]definitions.EvaluatedVariantDef{}
			p.defsByKey = map[string]definitions.FeatureDefinitionModel{}
			p.secure = map[string]struct{}{}
		}
	}
	p.mu.Unlock()
}

func (p *definitionsProvider) getDefinitionsRevision() string {
	p.mu.RLock()
	defer p.mu.RUnlock()
	if p.cfg.EnableVariants {
		return p.variantEtag
	}
	return p.etag
}

func (p *definitionsProvider) clearJWKS() {
	p.jwksMu.Lock()
	p.jwks = nil
	p.jwksExpiry = time.Time{}
	p.jwksMu.Unlock()

	p.mu.Lock()
	p.etag = ""
	p.variantEtag = ""
	p.mu.Unlock()
}

func (p *definitionsProvider) getVariant(featureKey string) *VariantResult {
	p.mu.RLock()
	defer p.mu.RUnlock()
	e, ok := p.variantsByKey[featureKey]
	if !ok || e.Variant == "" {
		return nil
	}
	return &VariantResult{Name: e.Variant, ConfigurationValue: e.ConfigurationValue}
}

func (p *definitionsProvider) refresh(ctx context.Context, timeout time.Duration, fromWebSocket bool) error {
	// Concurrent refresh skipped (in flight) — do not count.
	if !p.refreshInFlight.CompareAndSwap(false, true) {
		if fromWebSocket {
			p.pendingWSRefresh.Store(true)
		}
		return nil
	}
	defer func() {
		p.refreshInFlight.Store(false)
		if p.pendingWSRefresh.Swap(false) {
			// Drain WS notifies that arrived while in flight (no count on the skip).
			_ = p.refresh(context.Background(), 10*time.Second, true)
		}
	}()

	// Load durable snapshot once before the first network attempt. Do not
	// record a cache outcome here — one refresh() invocation emits exactly
	// one hit/miss from the network (or error) path below.
	p.mu.RLock()
	loaded := len(p.defsByKey) > 0
	p.mu.RUnlock()
	if !loaded {
		_, _ = p.loadSnapshot(ctx)
	}

	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	var (
		outcome refreshCacheOutcome
		err     error
	)
	switch {
	case p.cfg.EnableVariants:
		outcome, err = p.refreshEvaluatedVariants(ctx)
	case p.cfg.UseSignedDefinitions:
		outcome, err = p.refreshSigned(ctx)
	default:
		outcome, err = p.refreshUnsigned(ctx)
	}

	if err != nil {
		now := time.Now().UTC()
		p.mu.Lock()
		p.lastErr = err.Error()
		p.lastErrTime = &now
		p.mu.Unlock()
		// Network error / timeout keeping last good defs — hit.
		p.recordDefinitionCacheHit()
		return err
	}

	if outcome == refreshCacheMiss {
		p.recordDefinitionCacheMiss()
	} else {
		p.recordDefinitionCacheHit()
	}

	now := time.Now().UTC()
	p.mu.Lock()
	p.lastRefresh = &now
	p.mu.Unlock()
	return nil
}

// loadSnapshot loads durable defs. Returns true when it applied a snapshot into
// a previously empty in-memory store (startup durable path).
func (p *definitionsProvider) loadSnapshot(ctx context.Context) (bool, error) {
	if p.snap == nil {
		return false, nil
	}

	p.mu.RLock()
	contextKey, generation := p.variantContextKeyLocked(), p.variantGeneration
	p.mu.RUnlock()
	snapDefs, err := p.snap.LoadDefinitions(ctx)
	if err != nil || snapDefs == nil {
		return false, err
	}

	if p.cfg.EnableVariants {
		// Legacy snapshots cannot prove which evaluation context owns their payload.
		if snapDefs.VariantContext != contextKey {
			return false, nil
		}
		if p.cfg.UseSignedDefinitions {
			if err := p.verifySnapshotRawDefs(ctx, snapDefs.VariantRawDefs, snapDefs.VariantSignature, snapDefs.VariantKid, snapDefs.VariantTimestamp); err != nil {
				return false, err
			}
		}
		p.mu.Lock()
		defer p.mu.Unlock()
		if p.variantGeneration != generation {
			return false, nil
		}
		p.applyVariantDefinitionsLocked(snapDefs.VariantDefs)
		p.variantLastTS = snapDefs.VariantTimestamp
		p.variantEtag = snapDefs.ETag
		return true, nil
	}
	// Evaluated snapshots must never become global local-evaluation definitions.
	if snapDefs.VariantDefs != nil || snapDefs.VariantContext != "" {
		return false, nil
	}

	if len(snapDefs.Defs) > 0 {
		if p.cfg.UseSignedDefinitions {
			if err := p.verifySnapshotRawDefs(ctx, snapDefs.RawDefs, snapDefs.Signature, snapDefs.Kid, snapDefs.Timestamp); err != nil {
				return false, err
			}
		}
		p.applyDefinitions(snapDefs.Defs)
		p.mu.Lock()
		if snapDefs.Timestamp > 0 {
			p.lastTS = snapDefs.Timestamp
		}
		if snapDefs.ETag != "" {
			p.etag = snapDefs.ETag
		}
		p.mu.Unlock()
		return true, nil
	}
	return false, nil
}

// verifySnapshotRawDefs verifies a snapshot using the exact signed defs JSON.
// Legacy snapshots without RawDefs load typed features with a warning (no re-serialize verify).
func (p *definitionsProvider) verifySnapshotRawDefs(ctx context.Context, rawDefs []byte, signature, kid string, timestamp int64) error {
	if signature == "" || kid == "" || timestamp == 0 {
		log.Printf("toggly: snapshot is missing required signature fields")
		return fmt.Errorf("snapshot missing signature fields")
	}
	if len(rawDefs) == 0 {
		log.Printf("toggly: snapshot is missing RawDefs; loaded without cryptographic re-verification. Clear and refresh to upgrade the snapshot")
		return nil
	}

	jwks, err := p.loadOrFetchJWKS(ctx)
	if err != nil {
		return err
	}
	env := &definitions.SignedDefinitionsResponse{
		Defs:      rawDefs,
		Signature: signature,
		Kid:       kid,
		Timestamp: timestamp,
	}
	if err := crypto.VerifySignedDefinitions(env, jwks, p.cfg.AllowedKeyIDs); err != nil {
		return fmt.Errorf("snapshot signature verification failed: %w", err)
	}
	return nil
}

func (p *definitionsProvider) refreshUnsigned(ctx context.Context) (refreshCacheOutcome, error) {
	url := fmt.Sprintf("%sdefinitions/%s/%s", p.cfg.DefinitionsURL, p.cfg.AppKey, p.cfg.Environment)
	p.mu.RLock()
	etag := p.etag
	p.mu.RUnlock()

	req, err := newRefreshGET(ctx, url, etag)
	if err != nil {
		return refreshCacheHit, err
	}

	resp, err := p.hc.Do(req)
	if err != nil {
		return refreshCacheHit, err
	}
	defer func() { _ = resp.Body.Close() }()

	newETag, body, outcome, stop, err := evaluateRefreshHTTP(resp, etag, "definitions refresh")
	if stop {
		return outcome, err
	}

	defs, err := definitions.DecodeUnsignedDefinitions(body)
	if err != nil {
		return refreshCacheHit, err
	}

	p.applyDefinitions(defs)
	p.storeUnsignedETag(newETag)

	if p.snap != nil {
		_ = p.snap.SaveDefinitions(ctx, snapshot.DefinitionsSnapshot{Defs: defs})
	}
	return refreshCacheMiss, nil
}

func (p *definitionsProvider) refreshEvaluatedVariants(ctx context.Context) (refreshCacheOutcome, error) {
	p.mu.RLock()
	reqURL := p.variantURLLocked()
	contextKey, generation := p.variantContextKeyLocked(), p.variantGeneration
	etag := p.variantEtag
	currentTS := p.variantLastTS
	p.mu.RUnlock()

	req, err := newRefreshGET(ctx, reqURL, etag)
	if err != nil {
		return refreshCacheHit, err
	}

	resp, err := p.hc.Do(req)
	if err != nil {
		return refreshCacheHit, err
	}
	defer func() { _ = resp.Body.Close() }()

	newETag, body, outcome, stop, err := evaluateRefreshHTTP(resp, etag, "evaluated-variants-signed refresh")
	if stop {
		return outcome, err
	}

	env, err := definitions.DecodeSignedDefinitions(body)
	if err != nil {
		return refreshCacheHit, err
	}

	if isCachedRevision(currentTS, env.Timestamp) {
		return refreshCacheHit, nil
	}

	if p.cfg.UseSignedDefinitions && env.Signature != "" && env.Kid != "" {
		jwks, err := p.loadOrFetchJWKS(ctx)
		if err != nil {
			return refreshCacheHit, err
		}
		if err := crypto.VerifySignedDefinitions(env, jwks, p.cfg.AllowedKeyIDs); err != nil {
			return refreshCacheHit, err
		}
	}

	variantMap, err := definitions.DecodeEvaluatedVariantDefsMap(env.Defs)
	if err != nil {
		return refreshCacheHit, err
	}

	p.mu.Lock()
	if p.variantGeneration != generation {
		p.mu.Unlock()
		return refreshCacheHit, nil
	}
	p.applyVariantDefinitionsLocked(variantMap)
	p.variantEtag, p.variantLastTS = newETag, env.Timestamp

	defsSlice := make([]definitions.FeatureDefinitionModel, 0, len(variantMap))
	for k := range variantMap {
		if def, ok := p.defsByKey[k]; ok {
			defsSlice = append(defsSlice, def)
		}
	}
	p.mu.Unlock()

	if p.snap != nil {
		_ = p.snap.SaveDefinitions(ctx, snapshot.DefinitionsSnapshot{
			Defs:             defsSlice,
			Signature:        env.Signature,
			Kid:              env.Kid,
			Timestamp:        env.Timestamp,
			RawDefs:          env.Defs,
			ETag:             newETag,
			VariantContext:   contextKey,
			VariantDefs:      variantMap,
			VariantSignature: env.Signature,
			VariantKid:       env.Kid,
			VariantTimestamp: env.Timestamp,
			VariantRawDefs:   env.Defs,
		})
	}
	return refreshCacheMiss, nil
}

func (p *definitionsProvider) refreshSigned(ctx context.Context) (refreshCacheOutcome, error) {
	url := fmt.Sprintf("%sdefinitions-signed/%s/%s", p.cfg.DefinitionsURL, p.cfg.AppKey, p.cfg.Environment)
	p.mu.RLock()
	etag := p.etag
	currentTS := p.lastTS
	p.mu.RUnlock()

	req, err := newRefreshGET(ctx, url, etag)
	if err != nil {
		return refreshCacheHit, err
	}

	resp, err := p.hc.Do(req)
	if err != nil {
		return refreshCacheHit, err
	}
	defer func() { _ = resp.Body.Close() }()

	newETag, body, outcome, stop, err := evaluateRefreshHTTP(resp, etag, "signed definitions refresh")
	if stop {
		return outcome, err
	}

	env, err := definitions.DecodeSignedDefinitions(body)
	if err != nil {
		return refreshCacheHit, err
	}
	if isCachedRevision(currentTS, env.Timestamp) {
		return refreshCacheHit, nil
	}

	jwks, err := p.loadOrFetchJWKS(ctx)
	if err != nil {
		return refreshCacheHit, err
	}
	if err := crypto.VerifySignedDefinitions(env, jwks, p.cfg.AllowedKeyIDs); err != nil {
		return refreshCacheHit, err
	}

	defs, err := definitions.DecodeSignedDefsPayload(env.Defs)
	if err != nil {
		return refreshCacheHit, err
	}
	p.applyDefinitions(defs)
	p.storeSignedRevisionMeta(newETag, env.Timestamp)

	if p.snap != nil {
		_ = p.snap.SaveDefinitions(ctx, snapshot.DefinitionsSnapshot{
			Defs:      defs,
			Signature: env.Signature,
			Kid:       env.Kid,
			Timestamp: env.Timestamp,
			RawDefs:   env.Defs,
			ETag:      newETag,
		})
	}
	return refreshCacheMiss, nil
}

func newRefreshGET(ctx context.Context, reqURL, etag string) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, err
	}
	SetSDKHeaders(req)
	if etag != "" {
		req.Header.Set("If-None-Match", etag)
	}
	return req, nil
}

// evaluateRefreshHTTP shares 304 / non-OK / matching-etag / body-read handling
// across unsigned, signed, and evaluated-variants refresh paths. When stop is
// true, callers must return (outcome, err) immediately.
func evaluateRefreshHTTP(resp *http.Response, existingETag, failLabel string) (newETag string, body []byte, outcome refreshCacheOutcome, stop bool, err error) {
	if resp.StatusCode == http.StatusNotModified {
		return "", nil, refreshCacheHit, true, nil
	}
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return "", nil, refreshCacheHit, true, fmt.Errorf("%s failed: %s: %s", failLabel, resp.Status, string(b))
	}
	newETag = resp.Header.Get("ETag")
	// HTTP 200 whose etag matches existing (CDN replay) — cache hit.
	if etagsMatch(existingETag, newETag) {
		return newETag, nil, refreshCacheHit, true, nil
	}
	body, err = io.ReadAll(resp.Body)
	if err != nil {
		return newETag, nil, refreshCacheHit, true, err
	}
	return newETag, body, 0, false, nil
}

func isCachedRevision(currentTS, incomingTS int64) bool {
	return currentTS > 0 && incomingTS <= currentTS
}

func (p *definitionsProvider) storeUnsignedETag(newETag string) {
	if newETag == "" {
		return
	}
	p.mu.Lock()
	p.etag = newETag
	p.mu.Unlock()
}

func (p *definitionsProvider) storeSignedRevisionMeta(newETag string, ts int64) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if newETag != "" {
		p.etag = newETag
	}
	p.lastTS = ts
}

func etagsMatch(left, right string) bool {
	if left == "" || right == "" {
		return false
	}
	return normalizeETag(left) == normalizeETag(right)
}

func normalizeETag(etag string) string {
	trimmed := strings.TrimSpace(etag)
	if len(trimmed) >= 2 && (trimmed[0] == 'W' || trimmed[0] == 'w') && trimmed[1] == '/' {
		trimmed = strings.TrimSpace(trimmed[2:])
	}
	if len(trimmed) >= 2 && trimmed[0] == '"' && trimmed[len(trimmed)-1] == '"' {
		return trimmed[1 : len(trimmed)-1]
	}
	return trimmed
}

func (p *definitionsProvider) loadOrFetchJWKS(ctx context.Context) (*definitions.JWKSet, error) {
	// fast path
	p.jwksMu.Lock()
	if p.jwks != nil && time.Now().Before(p.jwksExpiry) {
		jwks := p.jwks
		p.jwksMu.Unlock()
		return jwks, nil
	}
	p.jwksMu.Unlock()

	// snapshot path
	if p.snap != nil {
		snap, err := p.snap.LoadJWKS(ctx)
		if err == nil && snap != nil && time.Now().Before(snap.Expiry) {
			p.jwksMu.Lock()
			p.jwks = &snap.Set
			p.jwksExpiry = snap.Expiry
			p.jwksMu.Unlock()
			return &snap.Set, nil
		}
	}

	// fetch
	url := fmt.Sprintf("%s.well-known/jwks", p.cfg.DefinitionsURL)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	SetSDKHeaders(req)
	resp, err := p.hc.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("jwks fetch failed: %s: %s", resp.Status, string(b))
	}
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	var jwks definitions.JWKSet
	if err := jsonUnmarshalUseNumber(b, &jwks); err != nil {
		return nil, fmt.Errorf("decode jwks: %w", err)
	}

	exp := time.Now().Add(30 * 24 * time.Hour)
	for _, k := range jwks.Keys {
		if k.Exp != nil {
			t := time.Unix(*k.Exp, 0)
			if t.Before(exp) {
				exp = t
			}
		}
	}

	p.jwksMu.Lock()
	p.jwks = &jwks
	p.jwksExpiry = exp
	p.jwksMu.Unlock()

	if p.snap != nil {
		_ = p.snap.SaveJWKS(ctx, snapshot.JWKSnap{Set: jwks, Expiry: exp})
	}
	return &jwks, nil
}

func (p *definitionsProvider) applyDefinitions(defs []definitions.FeatureDefinitionModel) {
	byKey := make(map[string]definitions.FeatureDefinitionModel, len(defs))
	secure := make(map[string]struct{})
	for _, d := range defs {
		// default requirement
		if d.RequirementType == "" {
			d.RequirementType = definitions.RequirementAny
		}
		byKey[d.FeatureKey] = d
		if d.SecuredFeature {
			secure[d.FeatureKey] = struct{}{}
		}
	}
	p.mu.Lock()
	p.defsByKey = byKey
	p.secure = secure
	p.variantsByKey = map[string]definitions.EvaluatedVariantDef{}
	p.mu.Unlock()
}

func (p *definitionsProvider) applyVariantDefinitionsLocked(variants map[string]definitions.EvaluatedVariantDef) {
	byKey := make(map[string]definitions.EvaluatedVariantDef, len(variants))
	defsByKey := make(map[string]definitions.FeatureDefinitionModel, len(variants))
	secure := make(map[string]struct{})

	for key, row := range variants {
		byKey[key] = row
		var filters []definitions.FeatureFilter
		if row.Enabled {
			filters = []definitions.FeatureFilter{{Name: "AlwaysOn", Parameters: map[string]any{}}}
		} else {
			filters = []definitions.FeatureFilter{{Name: "AlwaysOff", Parameters: map[string]any{}}}
		}
		defsByKey[key] = definitions.FeatureDefinitionModel{
			FeatureKey:      key,
			Filters:         filters,
			RequirementType: definitions.RequirementAny,
		}
	}

	p.variantsByKey = byKey
	p.defsByKey = defsByKey
	p.secure = secure
}

// Standard query encoding prevents delimiters in values from colliding in cache keys.
// Caller holds mu; groups and claims are immutable provider-owned startup copies.
func (p *definitionsProvider) variantURLLocked() string {
	q := url.Values{}
	if p.variantID != "" {
		q.Set("userId", p.variantID)
	}
	for _, group := range p.cfg.VariantGroups {
		q.Add("g", group)
	}
	for key, value := range p.cfg.VariantClaims {
		q.Set("claim."+key, value)
	}
	endpoint := fmt.Sprintf("%sevaluated-variants-signed/%s/%s", p.cfg.DefinitionsURL, url.PathEscape(p.cfg.AppKey), url.PathEscape(p.cfg.Environment))
	if len(q) > 0 {
		endpoint += "?" + q.Encode()
	}
	return endpoint
}

func (p *definitionsProvider) variantContextKeyLocked() string {
	return fmt.Sprintf("v1:%x", sha256.Sum256([]byte(p.variantURLLocked())))
}
