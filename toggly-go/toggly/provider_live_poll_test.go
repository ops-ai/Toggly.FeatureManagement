package toggly

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"nhooyr.io/websocket"
)

func TestProvider_LiveConnectedIdleStillPollsAtRefreshInterval(t *testing.T) {
	onJSON := `[{"featureKey":"f1","filters":[{"name":"AlwaysOn","parameters":{}}],"metrics":[],"securedFeature":false,"clientSdkEnabled":true,"requirementType":"Any"}]`
	offJSON := `[{"featureKey":"f1","filters":[],"metrics":[],"securedFeature":false,"clientSdkEnabled":true,"requirementType":"Any"}]`

	var defCalls atomic.Int32
	mux := http.NewServeMux()
	mux.HandleFunc("/definitions/app/env", func(w http.ResponseWriter, r *http.Request) {
		n := defCalls.Add(1)
		w.Header().Set("ETag", `"same"`)
		if n == 1 {
			_, _ = w.Write([]byte(onJSON))
			return
		}
		_, _ = w.Write([]byte(offJSON))
	})
	mux.HandleFunc("/app/ws", func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer func() { _ = c.Close(websocket.StatusNormalClosure, "") }()
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		for {
			if err := c.Write(ctx, websocket.MessageText, []byte(`{"type":"ping"}`)); err != nil {
				return
			}
			time.Sleep(50 * time.Millisecond)
		}
	})

	srv := httptest.NewServer(mux)
	defer srv.Close()

	p := newDefinitionsProvider(Config{
		AppKey:              "app",
		Environment:         "env",
		DefinitionsURL:      srv.URL + "/",
		HTTPTimeout:         2 * time.Second,
		RefreshInterval:     40 * time.Millisecond,
		EnableLiveUpdates:   true,
	}, nil)
	p.hc = srv.Client()
	p.start()

	deadline := time.Now().Add(3 * time.Second)
	for {
		def, ok := p.get("f1")
		if ok && len(def.Filters) == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("definitions still stale after idle WS; defCalls=%d", defCalls.Load())
		}
		time.Sleep(10 * time.Millisecond)
	}
	p.close()
}

func TestProvider_LiveConnectedWithoutInvalidationDoesNotSkipPoll(t *testing.T) {
	p := newDefinitionsProvider(Config{
		AppKey:          "app",
		Environment:     "env",
		DefinitionsURL:  "http://example.invalid/",
		RefreshInterval: time.Hour,
	}, nil)
	p.liveMu.Lock()
	p.liveConnected = true
	p.liveMu.Unlock()

	if p.shouldSkipRefresh() {
		t.Fatal("idle live socket must not suppress scheduled polling")
	}
}
