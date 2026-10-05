package toggly

// Coverage for Sonar new-code on segment membership client.

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
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

func TestSegmentMembershipClient_ListRemoveReplace(t *testing.T) {
	t.Parallel()

	var methods []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		methods = append(methods, r.Method+" "+r.URL.EscapedPath())
		if r.Header.Get("Authorization") != "backend-key" {
			http.Error(w, "auth", http.StatusUnauthorized)
			return
		}
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/v2/segments":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`[{"id":"abc","name":"Beta Testers","itemCount":1}]`))
		case r.Method == http.MethodDelete && strings.Contains(r.URL.Path, "/items"):
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"abc","itemCount":0}`))
		case r.Method == http.MethodPut && strings.Contains(r.URL.Path, "/items"):
			w.WriteHeader(http.StatusNoContent)
		default:
			http.Error(w, "unexpected "+r.Method+" "+r.URL.Path, http.StatusBadRequest)
		}
	}))
	t.Cleanup(server.Close)

	// Trailing slash exercises TrimRight in base().
	client := SegmentMembershipClient{AppKey: "backend-key", BaseURL: server.URL + "/", HTTP: server.Client()}

	segments, err := client.ListSegments()
	if err != nil {
		t.Fatal(err)
	}
	if len(segments) != 1 || segments[0]["id"] != "abc" {
		t.Fatalf("segments = %#v", segments)
	}

	summary, err := client.RemoveSegmentMembers("Beta Testers", []string{"user-1"})
	if err != nil {
		t.Fatal(err)
	}
	if summary["itemCount"] != float64(0) {
		t.Fatalf("remove summary = %#v", summary)
	}

	if _, err := client.ReplaceSegmentMembers("Beta Testers", []string{"user-2"}); err != nil {
		t.Fatal(err)
	}

	want := []string{
		"GET /api/v2/segments",
		"DELETE /api/v2/segments/Beta%20Testers/items",
		"PUT /api/v2/segments/Beta%20Testers/items",
	}
	if len(methods) != len(want) {
		t.Fatalf("methods = %#v", methods)
	}
	for i := range want {
		if methods[i] != want[i] {
			t.Fatalf("methods[%d] = %q want %q (all %#v)", i, methods[i], want[i], methods)
		}
	}
}

func TestSegmentMembershipClient_DefaultHTTPClient(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[]`))
	}))
	t.Cleanup(server.Close)

	// Nil HTTP uses http.DefaultClient (covers http()).
	client := SegmentMembershipClient{AppKey: "backend-key", BaseURL: server.URL}
	segments, err := client.ListSegments()
	if err != nil {
		t.Fatal(err)
	}
	if len(segments) != 0 {
		t.Fatalf("segments = %#v", segments)
	}
}

func TestSegmentMembershipClient_WhitespaceBodyIgnored(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("   \n"))
	}))
	t.Cleanup(server.Close)

	client := SegmentMembershipClient{AppKey: "backend-key", BaseURL: server.URL, HTTP: server.Client()}
	segments, err := client.ListSegments()
	if err != nil {
		t.Fatal(err)
	}
	if segments != nil {
		t.Fatalf("segments = %#v", segments)
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
