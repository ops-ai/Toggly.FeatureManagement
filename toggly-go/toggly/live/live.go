package live

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"

	"nhooyr.io/websocket"
)

const (
	// WSReconnectBase is the base delay between WebSocket reconnect attempts.
	WSReconnectBaseMs = 5000
	// WSReconnectMax caps exponential reconnect backoff.
	WSReconnectMaxMs = 60000

	sdkID      = "go"
	sdkVersion = "0.2.0"
)

type wsSyncMessage struct {
	Type      string `json:"type"`
	ETag      string `json:"etag"`
	Unchanged *bool  `json:"unchanged"`
	Kid       string `json:"kid"`
}

// Start connects to the Toggly live updates WebSocket channel.
//
// It connects to wss://{baseURL}/{appKey}/ws?rev={cachedRevision} when
// [cachedRevision] is non-empty and calls [onUpdate] when a fetch should occur
// for sync, flags-updated, or signing-key-updated messages. Ping messages are
// ignored. [onUpdate] receives true when JWKS and definitions must be refreshed
// (signing-key-updated).
func Start(
	ctx context.Context,
	baseURL, appKey, envKey string,
	httpClient *http.Client,
	cachedRevision string,
	onUpdate func(forceJWKSRefresh bool),
) (io.Closer, error) {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}

	wsURL := buildWebSocketURL(baseURL, appKey, cachedRevision)

	c, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
		HTTPClient: httpClient,
	})
	if err != nil {
		return nil, err
	}

	go func() {
		defer func() { _ = c.Close(websocket.StatusNormalClosure, "") }()
		for {
			_, msg, readErr := c.Read(ctx)
			if readErr != nil {
				return
			}
			if forceJWKS, shouldUpdate := shouldTriggerUpdate(msg, cachedRevision); shouldUpdate {
				go func(forceJWKS bool) {
					defer func() { _ = recover() }()
					onUpdate(forceJWKS)
				}(forceJWKS)
			}
		}
	}()

	return closerFunc(func() error {
		return c.Close(websocket.StatusNormalClosure, "")
	}), nil
}

// shouldTriggerUpdate returns whether [onUpdate] should run and whether JWKS
// must be refreshed.
func shouldTriggerUpdate(msg []byte, cachedRevision string) (forceJWKSRefresh bool, shouldUpdate bool) {
	text := strings.TrimSpace(string(msg))
	if text == "update" || text == "flags-updated" {
		return false, true
	}

	var payload wsSyncMessage
	if json.Unmarshal(msg, &payload) != nil {
		return false, false
	}

	switch payload.Type {
	case "ping":
		return false, false
	case "sync":
		return false, shouldFetchOnSync(payload, cachedRevision)
	case "signing-key-updated":
		return true, true
	case "flags-updated", "update":
		return false, shouldFetchOnFlagsUpdated(payload, cachedRevision)
	default:
		return false, false
	}
}

func shouldFetchOnSync(msg wsSyncMessage, cachedRevision string) bool {
	if msg.Type != "sync" {
		return false
	}
	if msg.Unchanged != nil && *msg.Unchanged {
		return false
	}
	if cachedRevision == "" {
		return true
	}
	if msg.ETag != "" && msg.ETag != cachedRevision {
		return true
	}
	return false
}

func shouldFetchOnFlagsUpdated(msg wsSyncMessage, cachedRevision string) bool {
	if msg.Type != "flags-updated" {
		return true
	}
	if msg.ETag == "" || cachedRevision == "" {
		return true
	}
	return msg.ETag != cachedRevision
}

func buildWebSocketURL(baseURL, appKey, cachedRevision string) string {
	base := strings.TrimRight(baseURL, "/")
	base = strings.Replace(base, "https://", "wss://", 1)
	base = strings.Replace(base, "http://", "ws://", 1)
	wsURL := base + "/" + appKey + "/ws"
	q := url.Values{}
	if cachedRevision != "" {
		q.Set("rev", cachedRevision)
	}
	q.Set("sdk", sdkID)
	q.Set("sdkVersion", sdkVersion)
	return wsURL + "?" + q.Encode()
}

type closerFunc func() error

func (c closerFunc) Close() error { return c() }
