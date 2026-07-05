package live

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"nhooyr.io/websocket"
)

func TestStart_CallsOnUpdate(t *testing.T) {
	updated := make(chan struct{}, 1)

	mux := http.NewServeMux()

	// The new live.Start() connects directly to {baseURL}/{appKey}/ws
	mux.HandleFunc("/app/ws", func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer func() { _ = c.Close(websocket.StatusNormalClosure, "") }()

		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		_ = c.Write(ctx, websocket.MessageText, []byte(`{"type":"flags-updated"}`))
	})

	srv := httptest.NewServer(mux)
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	closer, err := Start(ctx, srv.URL, "app", "env", srv.Client(), "", func(forceJWKSRefresh bool) {
		if forceJWKSRefresh {
			t.Fatalf("unexpected forceJWKSRefresh")
		}
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
