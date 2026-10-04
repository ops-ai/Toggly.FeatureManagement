package toggly

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSegmentMembershipClient_AddPostsIdentifiers(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method", http.StatusMethodNotAllowed)
			return
		}
		if r.URL.EscapedPath() != "/api/v2/segments/Beta%20Testers/items" && r.URL.Path != "/api/v2/segments/Beta Testers/items" {
			http.Error(w, "path "+r.URL.RequestURI(), http.StatusBadRequest)
			return
		}
		if got := r.Header.Get("Authorization"); got != "backend-key" {
			http.Error(w, "auth", http.StatusUnauthorized)
			return
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		var payload map[string]any
		if err := json.Unmarshal(body, &payload); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		ids, _ := payload["identifiers"].([]any)
		if len(ids) != 1 || ids[0] != "user-1" {
			http.Error(w, "identifiers", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"list-1","itemCount":1}`))
	}))
	t.Cleanup(server.Close)

	client := SegmentMembershipClient{AppKey: "backend-key", BaseURL: server.URL, HTTP: server.Client()}
	summary, err := client.AddSegmentMembers("Beta Testers", []string{"user-1"})
	if err != nil {
		t.Fatal(err)
	}
	if summary["id"] != "list-1" {
		t.Fatalf("summary = %#v", summary)
	}
}

func TestSegmentMembershipClient_HTTPError(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	t.Cleanup(server.Close)

	client := SegmentMembershipClient{AppKey: "frontend-key", BaseURL: server.URL, HTTP: server.Client()}
	_, err := client.ListSegments()
	if err == nil {
		t.Fatal("expected error")
	}
}
