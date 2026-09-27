package live

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
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

func TestStartRejectsPlaintextWebSocketForRemoteHost(t *testing.T) {
	_, err := Start(context.Background(), "http://features.example.com", "app", "env", nil, "", func(bool) {})
	if err == nil || !strings.Contains(err.Error(), "secure WebSocket") {
		t.Fatalf("remote HTTP endpoint error = %v, want secure WebSocket rejection", err)
	}
}

func TestBuildWebSocketURLPreservesSecureTransportAndRevision(t *testing.T) {
	for _, tc := range []struct {
		base   string
		scheme string
	}{
		{"https://features.example.com/", "wss"},
		{"http://127.0.0.1:8080/", "ws"},
		{"http://[::1]:8080/", "ws"},
	} {
		raw, err := buildWebSocketURL(tc.base, "app", "revision-1")
		if err != nil {
			t.Fatalf("base %q: %v", tc.base, err)
		}
		u, err := url.Parse(raw)
		if err != nil || u.Scheme != tc.scheme || u.Path != "/app/ws" || u.Query().Get("rev") != "revision-1" || u.Query().Get("sdk") != sdkID || u.Query().Get("sdkVersion") != sdkVersion {
			t.Fatalf("base %q: URL = %q, %v", tc.base, raw, err)
		}
	}
	for _, base := range []string{"ws://features.example.com", "ftp://features.example.com"} {
		if raw, err := buildWebSocketURL(base, "app", ""); err == nil {
			t.Fatalf("unsupported remote base %q yielded %q", base, raw)
		}
	}
}
