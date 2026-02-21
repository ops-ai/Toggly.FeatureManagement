package live

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"

	"nhooyr.io/websocket"
)

// Start connects to the Toggly live updates channel.
//
// It first resolves the WebSocket URL by calling:
//
//	GET {baseURL}definitions/live-updates/{appKey}/{envKey}
//
// Then connects and calls onUpdate when receiving the text message "update".
func Start(ctx context.Context, baseURL, appKey, envKey string, httpClient *http.Client, onUpdate func()) (io.Closer, error) {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}

	wsURL, err := resolveWebSocketURL(ctx, httpClient, baseURL, appKey, envKey)
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
		defer c.Close(websocket.StatusNormalClosure, "")
		for {
			_, msg, err := c.Read(ctx)
			if err != nil {
				return
			}
			if string(msg) == "update" {
				// Fire-and-forget like .NET SDK.
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

func resolveWebSocketURL(ctx context.Context, httpClient *http.Client, baseURL, appKey, envKey string) (string, error) {
	lookupURL := fmt.Sprintf("%s/definitions/live-updates/%s/%s", strings.TrimRight(baseURL, "/"), appKey, envKey)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, lookupURL, nil)
	if err != nil {
		return "", err
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(body)), nil
}

type closerFunc func() error

func (c closerFunc) Close() error { return c() }
