package live

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"nhooyr.io/websocket"
)

// Start connects to the Toggly live updates WebSocket channel.
//
// It connects to wss://{baseURL}/{appKey}/ws and calls onUpdate when receiving
// a "flags-updated" or "update" message. Ping messages are ignored.
func Start(ctx context.Context, baseURL, appKey, envKey string, httpClient *http.Client, onUpdate func()) (io.Closer, error) {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}

	wsURL := buildWebSocketURL(baseURL, appKey)

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
			if shouldTriggerUpdate(msg) {
				go func() {
					defer func() { _ = recover() }()
					onUpdate()
				}()
			}
		}
	}()

	return closerFunc(func() error {
		return c.Close(websocket.StatusNormalClosure, "")
	}), nil
}

// shouldTriggerUpdate returns true when the message signals a definitions change.
func shouldTriggerUpdate(msg []byte) bool {
	var payload struct {
		Type string `json:"type"`
	}
	if json.Unmarshal(msg, &payload) == nil {
		return payload.Type == "flags-updated" || payload.Type == "update"
	}
	text := string(msg)
	return text == "update" || text == "flags-updated"
}

func buildWebSocketURL(baseURL, appKey string) string {
	base := strings.TrimRight(baseURL, "/")
	base = strings.Replace(base, "https://", "wss://", 1)
	base = strings.Replace(base, "http://", "ws://", 1)
	return base + "/" + appKey + "/ws"
}

type closerFunc func() error

func (c closerFunc) Close() error { return c() }
