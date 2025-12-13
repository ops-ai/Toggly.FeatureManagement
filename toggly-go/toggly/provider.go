package toggly

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/crypto"
	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/definitions"
	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/live"
	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/snapshot"
)

type definitionsProvider struct {
	cfg      Config
	hc       *http.Client
	snap     snapshot.Provider

	mu       sync.RWMutex
	defsByKey map[string]definitions.FeatureDefinitionModel
	etag     string
	lastTS   int64
	secure   map[string]struct{}

	lastErr     string
	lastErrTime *time.Time
	lastRefresh *time.Time

	jwksMu     sync.Mutex
	jwks       *definitions.JWKSet
	jwksExpiry time.Time

	liveMu     sync.Mutex
	liveCloser io.Closer

	stop chan struct{}
	wg   sync.WaitGroup
}

func newDefinitionsProvider(cfg Config, snap snapshot.Provider) *definitionsProvider {
	cfg.applyDefaults()
	return &definitionsProvider{
		cfg:       cfg,
		hc:        &http.Client{Timeout: cfg.HTTPTimeout},
		snap:      snap,
		defsByKey: map[string]definitions.FeatureDefinitionModel{},
		secure:    map[string]struct{}{},
		stop:      make(chan struct{}),
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
				_ = p.refresh(context.Background(), p.cfg.HTTPTimeout)
			}
		}
	}()
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

	closer, err := live.Start(ctx, p.cfg.BaseURL, p.cfg.AppKey, p.cfg.Environment, p.hc, func() {
		_ = p.refresh(context.Background(), 10*time.Second)
	})
	if err != nil {
		return
	}
	p.liveMu.Lock()
	p.liveCloser = closer
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
	if p.cfg.UseSignedDefinitions {
		err = p.refreshSigned(ctx)
	} else {
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

	p.applyDefinitions(snapDefs.Defs)
	p.mu.Lock()
	if snapDefs.Timestamp > 0 {
		p.lastTS = snapDefs.Timestamp
	}
	p.mu.Unlock()
	return nil
}

func (p *definitionsProvider) refreshUnsigned(ctx context.Context) error {
	url := fmt.Sprintf("%sdefinitions/%s/%s", p.cfg.BaseURL, p.cfg.AppKey, p.cfg.Environment)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
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
	defer resp.Body.Close()

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

func (p *definitionsProvider) refreshSigned(ctx context.Context) error {
	url := fmt.Sprintf("%sdefinitions/v2/%s/%s", p.cfg.BaseURL, p.cfg.AppKey, p.cfg.Environment)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
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
	defer resp.Body.Close()

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
	url := fmt.Sprintf("%s.well-known/jwks", p.cfg.BaseURL)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := p.hc.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
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
	p.mu.Unlock()
}
