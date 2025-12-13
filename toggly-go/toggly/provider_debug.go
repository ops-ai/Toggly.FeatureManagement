package toggly

import "time"

// ProviderDebugInfo is similar to the .NET IFeatureProviderDebug output.
type ProviderDebugInfo struct {
	AppKey      string
	Environment string

	DefinitionsCount int
	ETag             string
	LastTimestamp    int64

	LastError     string
	LastErrorTime *time.Time
	LastRefresh   *time.Time

	LiveUpdatesEnabled bool
	LiveUpdatesRunning bool
}

func (p *definitionsProvider) debugInfo() ProviderDebugInfo {
	p.mu.RLock()
	defer p.mu.RUnlock()

	p.liveMu.Lock()
	liveRunning := p.liveCloser != nil
	p.liveMu.Unlock()

	return ProviderDebugInfo{
		AppKey:             p.cfg.AppKey,
		Environment:        p.cfg.Environment,
		DefinitionsCount:   len(p.defsByKey),
		ETag:              p.etag,
		LastTimestamp:     p.lastTS,
		LastError:         p.lastErr,
		LastErrorTime:     p.lastErrTime,
		LastRefresh:       p.lastRefresh,
		LiveUpdatesEnabled: p.cfg.EnableLiveUpdates,
		LiveUpdatesRunning: liveRunning,
	}
}

// ProviderDebugInfo returns debug details about the underlying provider.
func (c *Client) ProviderDebugInfo() ProviderDebugInfo {
	if c == nil || c.provider == nil {
		return ProviderDebugInfo{}
	}
	return c.provider.debugInfo()
}
