package live

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"nhooyr.io/websocket"
)

func TestStart_CallsOnUpdate(t *testing.T) {
	updated := make(chan struct{}, 1)

	mux := http.NewServeMux()
	srv := httptest.NewServer(mux)
	defer srv.Close()

	wsURL := strings.Replace(srv.URL, "http://", "ws://", 1) + "/ws"

	mux.HandleFunc("/definitions/live-updates/app/env", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(wsURL))
	})

	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer func() { _ = c.Close(websocket.StatusNormalClosure, "") }()

		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		_ = c.Write(ctx, websocket.MessageText, []byte("update"))
	})

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	closer, err := Start(ctx, srv.URL+"/", "app", "env", srv.Client(), func() {
		select {
		case updated <- struct{}{}:
		default:
		}
	})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer func() { _ = closer.Close() }()

	select {
	case <-updated:
		// ok
	case <-time.After(2 * time.Second):
		t.Fatalf("expected onUpdate to be called")
	}
}
