package live

import (
	"context"
	"fmt"
	"io"
	"strings"
	"time"

	"nhooyr.io/websocket"
)

// Start connects to the Toggly live updates channel directly.
//
// It connects to:
//   wss://definitions.toggly.io/{appKey}/ws
//
// Then connects and calls onUpdate when receiving the text message "update".
func Start(ctx context.Context, baseURL, appKey string, onUpdate func(), onDisconnect func()) (io.Closer, error) {
	wsURL := buildWebSocketURL(baseURL, appKey)
	c, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{})
	if err != nil {
		return nil, err
	}

	go func() {
		defer c.Close(websocket.StatusNormalClosure, "")
		defer func() {
			if onDisconnect != nil {
				onDisconnect()
			}
		}()
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

func buildWebSocketURL(baseURL, appKey string) string {
	base := strings.TrimRight(baseURL, "/")
	switch {
	case strings.HasPrefix(base, "https://"):
		base = "wss://" + strings.TrimPrefix(base, "https://")
	case strings.HasPrefix(base, "http://"):
		base = "ws://" + strings.TrimPrefix(base, "http://")
	}
	return fmt.Sprintf("%s/%s/ws", base, appKey)
}

type closerFunc func() error

func (c closerFunc) Close() error { return c() }
