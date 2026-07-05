package toggly

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/crypto"
	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/definitions"
	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/live"
	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/snapshot"
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
	variantsByKey map[string]definitions.EvaluatedVariantDef
	variantEtag   string
	variantLastTS int64
	variantID     string

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

	stop chan struct{}
	wg   sync.WaitGroup
}

func newDefinitionsProvider(cfg Config, snap snapshot.Provider) *definitionsProvider {
	cfg.applyDefaults()
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

func (p *definitionsProvider) start() {
	p.wg.Add(1)
	go func() {
		defer p.wg.Done()
		ticker := time.NewTicker(p.cfg.RefreshInterval)
		defer ticker.Stop()

		// initial refresh best-effort
		_ = p.refresh(context.Background(), p.cfg.HTTPTimeout)
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
					continue
				}
				_ = p.refresh(context.Background(), p.cfg.HTTPTimeout)
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
		_ = p.refresh(context.Background(), 10*time.Second)
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
		p.variantEtag = ""
	}
	p.mu.Unlock()
}

func (p *definitionsProvider) getVariantIdentity() string {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.variantID
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

func (p *definitionsProvider) refresh(ctx context.Context, timeout time.Duration) error {
	// load snapshot once on first refresh attempt
	p.mu.RLock()
	loaded := len(p.defsByKey) > 0
	p.mu.RUnlock()
	if !loaded {
		_ = p.loadSnapshot(ctx)
	}

	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	var err error
	switch {
	case p.cfg.EnableVariants:
		err = p.refreshEvaluatedVariants(ctx)
	case p.cfg.UseSignedDefinitions:
		err = p.refreshSigned(ctx)
	default:
		err = p.refreshUnsigned(ctx)
	}

	if err != nil {
		now := time.Now().UTC()
		p.mu.Lock()
		p.lastErr = err.Error()
		p.lastErrTime = &now
		p.mu.Unlock()
		return err
	}

	now := time.Now().UTC()
	p.mu.Lock()
	p.lastRefresh = &now
	p.mu.Unlock()
	return nil
}

func (p *definitionsProvider) loadSnapshot(ctx context.Context) error {
	if p.snap == nil {
		return nil
	}

	snapDefs, err := p.snap.LoadDefinitions(ctx)
	if err != nil || snapDefs == nil {
		return err
	}

	if p.cfg.EnableVariants && len(snapDefs.VariantDefs) > 0 {
		p.applyVariantDefinitions(snapDefs.VariantDefs)
		p.mu.Lock()
		if snapDefs.VariantTimestamp > 0 {
			p.variantLastTS = snapDefs.VariantTimestamp
		}
		p.mu.Unlock()
		return nil
	}

	if len(snapDefs.Defs) > 0 {
		p.applyDefinitions(snapDefs.Defs)
		p.mu.Lock()
		if snapDefs.Timestamp > 0 {
			p.lastTS = snapDefs.Timestamp
		}
		p.mu.Unlock()
	}
	return nil
}

func (p *definitionsProvider) refreshUnsigned(ctx context.Context) error {
	url := fmt.Sprintf("%sdefinitions/%s/%s", p.cfg.DefinitionsURL, p.cfg.AppKey, p.cfg.Environment)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	SetSDKHeaders(req)
	p.mu.RLock()
	etag := p.etag
	p.mu.RUnlock()
	if etag != "" {
		req.Header.Set("If-None-Match", etag)
	}

	resp, err := p.hc.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode == http.StatusNotModified {
		return nil
	}
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("definitions refresh failed: %s: %s", resp.Status, string(b))
	}

	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	defs, err := definitions.DecodeUnsignedDefinitions(b)
	if err != nil {
		return err
	}

	p.applyDefinitions(defs)
	if newETag := resp.Header.Get("ETag"); newETag != "" {
		p.mu.Lock()
		p.etag = newETag
		p.mu.Unlock()
	}

	if p.snap != nil {
		_ = p.snap.SaveDefinitions(ctx, snapshot.DefinitionsSnapshot{Defs: defs})
	}
	return nil
}

func (p *definitionsProvider) refreshEvaluatedVariants(ctx context.Context) error {
	reqURL := fmt.Sprintf("%sevaluated-variants-signed/%s/%s", p.cfg.DefinitionsURL, url.PathEscape(p.cfg.AppKey), url.PathEscape(p.cfg.Environment))
	if id := p.getVariantIdentity(); id != "" {
		reqURL += "?userId=" + url.QueryEscape(id)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return err
	}
	SetSDKHeaders(req)
	p.mu.RLock()
	etag := p.variantEtag
	currentTS := p.variantLastTS
	p.mu.RUnlock()
	if etag != "" {
		req.Header.Set("If-None-Match", etag)
	}

	resp, err := p.hc.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode == http.StatusNotModified {
		return nil
	}
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("evaluated-variants-signed refresh failed: %s: %s", resp.Status, string(b))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	env, err := definitions.DecodeSignedDefinitions(body)
	if err != nil {
		return err
	}

	if env.Timestamp < currentTS && currentTS > 0 {
		return nil
	}

	if p.cfg.UseSignedDefinitions && env.Signature != "" && env.Kid != "" {
		jwks, err := p.loadOrFetchJWKS(ctx)
		if err != nil {
			return err
		}
		if err := crypto.VerifySignedDefinitions(env, jwks, p.cfg.AllowedKeyIDs); err != nil {
			return err
		}
	}

	variantMap, err := definitions.DecodeEvaluatedVariantDefsMap(env.Defs)
	if err != nil {
		return err
	}

	p.applyVariantDefinitions(variantMap)

	defsSlice := make([]definitions.FeatureDefinitionModel, 0, len(variantMap))
	p.mu.RLock()
	for k := range variantMap {
		if def, ok := p.defsByKey[k]; ok {
			defsSlice = append(defsSlice, def)
		}
	}
	p.mu.RUnlock()

	if newETag := resp.Header.Get("ETag"); newETag != "" {
		p.mu.Lock()
		p.variantEtag = newETag
		p.variantLastTS = env.Timestamp
		p.mu.Unlock()
	} else {
		p.mu.Lock()
		p.variantLastTS = env.Timestamp
		p.mu.Unlock()
	}

	if p.snap != nil {
		_ = p.snap.SaveDefinitions(ctx, snapshot.DefinitionsSnapshot{
			Defs:             defsSlice,
			Signature:        env.Signature,
			Kid:              env.Kid,
			Timestamp:        env.Timestamp,
			VariantDefs:      variantMap,
			VariantSignature: env.Signature,
			VariantKid:       env.Kid,
			VariantTimestamp: env.Timestamp,
		})
	}
	return nil
}

func (p *definitionsProvider) refreshSigned(ctx context.Context) error {
	url := fmt.Sprintf("%sdefinitions-signed/%s/%s", p.cfg.DefinitionsURL, p.cfg.AppKey, p.cfg.Environment)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	SetSDKHeaders(req)
	p.mu.RLock()
	etag := p.etag
	currentTS := p.lastTS
	p.mu.RUnlock()
	if etag != "" {
		req.Header.Set("If-None-Match", etag)
	}

	resp, err := p.hc.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode == http.StatusNotModified {
		return nil
	}
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("signed definitions refresh failed: %s: %s", resp.Status, string(b))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	env, err := definitions.DecodeSignedDefinitions(body)
	if err != nil {
		return err
	}
	if env.Timestamp < currentTS {
		return nil
	}

	jwks, err := p.loadOrFetchJWKS(ctx)
	if err != nil {
		return err
	}
	if err := crypto.VerifySignedDefinitions(env, jwks, p.cfg.AllowedKeyIDs); err != nil {
		return err
	}

	defs, err := definitions.DecodeSignedDefsPayload(env.Defs)
	if err != nil {
		return err
	}
	p.applyDefinitions(defs)

	if newETag := resp.Header.Get("ETag"); newETag != "" {
		p.mu.Lock()
		p.etag = newETag
		p.lastTS = env.Timestamp
		p.mu.Unlock()
	}

	if p.snap != nil {
		_ = p.snap.SaveDefinitions(ctx, snapshot.DefinitionsSnapshot{Defs: defs, Signature: env.Signature, Kid: env.Kid, Timestamp: env.Timestamp})
	}
	return nil
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

func (p *definitionsProvider) applyVariantDefinitions(variants map[string]definitions.EvaluatedVariantDef) {
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

	p.mu.Lock()
	p.variantsByKey = byKey
	p.defsByKey = defsByKey
	p.secure = secure
	p.mu.Unlock()
}
