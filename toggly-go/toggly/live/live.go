package live

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
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

	sdkID               = "go"
	sdkVersion          = "0.11.1"
	flagsUpdatedMessage = "flags-updated"
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

	wsURL, err := buildWebSocketURL(baseURL, appKey, cachedRevision)
	if err != nil {
		return nil, err
	}

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
	if text == "update" || text == flagsUpdatedMessage {
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
	case flagsUpdatedMessage, "update":
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
	if msg.Type != flagsUpdatedMessage {
		return true
	}
	if msg.ETag == "" || cachedRevision == "" {
		return true
	}
	return msg.ETag != cachedRevision
}

func buildWebSocketURL(baseURL, appKey, cachedRevision string) (string, error) {
	u, err := url.Parse(baseURL)
	if err != nil {
		return "", err
	}
	switch u.Scheme {
	case "https", "wss":
		u.Scheme = "wss"
	case "http", "ws":
		ip := net.ParseIP(u.Hostname())
		if !strings.EqualFold(u.Hostname(), "localhost") && (ip == nil || !ip.IsLoopback()) {
			return "", fmt.Errorf("secure WebSocket required for remote host %q", u.Hostname())
		}
		u.Scheme = "ws"
	default:
		return "", fmt.Errorf("unsupported WebSocket base URL scheme %q", u.Scheme)
	}
	u.Path = strings.TrimRight(u.Path, "/") + "/" + appKey + "/ws"
	q := u.Query()
	if cachedRevision != "" {
		q.Set("rev", cachedRevision)
	}
	q.Set("sdk", sdkID)
	q.Set("sdkVersion", sdkVersion)
	u.RawQuery = q.Encode()
	return u.String(), nil
}

type closerFunc func() error

func (c closerFunc) Close() error { return c() }
