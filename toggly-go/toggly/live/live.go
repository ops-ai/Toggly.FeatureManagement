package live

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"time"

	"nhooyr.io/websocket"
)

// Start connects to the Toggly live updates channel.
//
// It fetches the WebSocket URL from:
//   GET {baseURL}/definitions/live-updates/{appKey}/{env}
//
// Then connects and calls onUpdate when receiving the text message "update".
func Start(ctx context.Context, baseURL, appKey, env string, hc *http.Client, onUpdate func()) (io.Closer, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("%sdefinitions/live-updates/%s/%s", baseURL, appKey, env), nil)
	if err != nil {
		return nil, err
	}
	resp, err := hc.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("live-updates url fetch failed: %s", resp.Status)
	}
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	wsURL := string(b)

	c, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{})
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
					// small guard
					defer func() { _ = recover() }()
					onUpdate()
				}()
			}
		}
	}()

	return closerFunc(func() error {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		return c.Close(websocket.StatusNormalClosure, ctx.Err().Error())
	}), nil
}

type closerFunc func() error

func (c closerFunc) Close() error { return c() }
