package toggly

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// No other SDK currently loads tests/segment-membership/contract.json.
// Go exposes SegmentMembershipClient for this HTTP API, so we drive a
// contract-shaped smoke against the shared fixture when present.

type segmentMembershipContract struct {
	SchemaVersion int    `json:"schemaVersion"`
	Host          string `json:"host"`
	BasePath      string `json:"basePath"`
	Auth          struct {
		Header  string   `json:"header"`
		Schemes []string `json:"schemes"`
		KeyType string   `json:"keyType"`
	} `json:"auth"`
	Routes []struct {
		Method string `json:"method"`
		Path   string `json:"path"`
		Name   string `json:"name"`
	} `json:"routes"`
	Body struct {
		Identifiers []string `json:"identifiers"`
	} `json:"body"`
}

func resolveSegmentMembershipContract(t *testing.T) string {
	t.Helper()
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	candidates := []string{
		filepath.Join(cwd, "tests", "segment-membership", "contract.json"),
		filepath.Join(cwd, "..", "tests", "segment-membership", "contract.json"),
		filepath.Join(cwd, "..", "..", "tests", "segment-membership", "contract.json"),
		filepath.Join(cwd, "..", "..", "..", "tests", "segment-membership", "contract.json"),
	}
	for _, candidate := range candidates {
		if _, err := os.Stat(candidate); err == nil {
			abs, err := filepath.Abs(candidate)
			if err != nil {
				return candidate
			}
			return abs
		}
	}
	walk := cwd
	for i := 0; i < 6; i++ {
		candidate := filepath.Join(walk, "tests", "segment-membership", "contract.json")
		if _, err := os.Stat(candidate); err == nil {
			abs, err := filepath.Abs(candidate)
			if err != nil {
				return candidate
			}
			return abs
		}
		parent := filepath.Dir(walk)
		if parent == walk {
			break
		}
		walk = parent
	}
	t.Fatal("tests/segment-membership/contract.json not found")
	return ""
}

func TestSegmentMembershipContractRoutes(t *testing.T) {
	data, err := os.ReadFile(resolveSegmentMembershipContract(t))
	if err != nil {
		t.Fatalf("read contract: %v", err)
	}
	var contract segmentMembershipContract
	if err := json.Unmarshal(data, &contract); err != nil {
		t.Fatalf("parse contract: %v", err)
	}
	if contract.SchemaVersion != 1 {
		t.Fatalf("unexpected schemaVersion %d", contract.SchemaVersion)
	}
	if contract.BasePath != "/api/v2/segments" {
		t.Fatalf("unexpected basePath %q", contract.BasePath)
	}
	if contract.Auth.Header != "Authorization" {
		t.Fatalf("unexpected auth header %q", contract.Auth.Header)
	}

	routeByName := map[string]struct {
		Method string
		Path   string
	}{}
	for _, route := range contract.Routes {
		routeByName[route.Name] = struct {
			Method string
			Path   string
		}{Method: route.Method, Path: route.Path}
	}
	for _, name := range []string{"listSegments", "addSegmentMembers", "removeSegmentMembers", "replaceSegmentMembers"} {
		if _, ok := routeByName[name]; !ok {
			t.Fatalf("contract missing route %s", name)
		}
	}

	var seen []struct {
		Method, Path, Auth string
		Body               map[string]any
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if r.Body != nil && r.ContentLength != 0 {
			_ = json.NewDecoder(r.Body).Decode(&body)
		}
		seen = append(seen, struct {
			Method, Path, Auth string
			Body               map[string]any
		}{Method: r.Method, Path: r.URL.Path, Auth: r.Header.Get("Authorization"), Body: body})
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/v2/segments":
			_, _ = w.Write([]byte(`[]`))
		default:
			_, _ = w.Write([]byte(`{}`))
		}
	}))
	defer server.Close()

	client := SegmentMembershipClient{AppKey: "backend-key", BaseURL: server.URL, HTTP: server.Client()}
	identifiers := contract.Body.Identifiers
	if len(identifiers) == 0 {
		identifiers = []string{"user-123"}
	}

	if _, err := client.ListSegments(); err != nil {
		t.Fatalf("ListSegments: %v", err)
	}
	if _, err := client.AddSegmentMembers("beta", identifiers); err != nil {
		t.Fatalf("AddSegmentMembers: %v", err)
	}
	if _, err := client.RemoveSegmentMembers("beta", identifiers); err != nil {
		t.Fatalf("RemoveSegmentMembers: %v", err)
	}
	if _, err := client.ReplaceSegmentMembers("beta", identifiers); err != nil {
		t.Fatalf("ReplaceSegmentMembers: %v", err)
	}

	expect := []struct {
		name    string
		method  string
		path    string
		hasBody bool
	}{
		{"listSegments", routeByName["listSegments"].Method, "/api/v2/segments", false},
		{"addSegmentMembers", routeByName["addSegmentMembers"].Method, "/api/v2/segments/beta/items", true},
		{"removeSegmentMembers", routeByName["removeSegmentMembers"].Method, "/api/v2/segments/beta/items", true},
		{"replaceSegmentMembers", routeByName["replaceSegmentMembers"].Method, "/api/v2/segments/beta/items", true},
	}
	if len(seen) != len(expect) {
		t.Fatalf("saw %d requests, want %d", len(seen), len(expect))
	}
	for i, want := range expect {
		got := seen[i]
		if !strings.EqualFold(got.Method, want.method) {
			t.Fatalf("%s: method %s want %s", want.name, got.Method, want.method)
		}
		if got.Path != want.path {
			t.Fatalf("%s: path %s want %s", want.name, got.Path, want.path)
		}
		if got.Auth != "backend-key" {
			t.Fatalf("%s: Authorization %q", want.name, got.Auth)
		}
		if want.hasBody {
			raw, _ := json.Marshal(got.Body["identifiers"])
			var gotIDs []string
			_ = json.Unmarshal(raw, &gotIDs)
			if strings.Join(gotIDs, ",") != strings.Join(identifiers, ",") {
				t.Fatalf("%s: identifiers %#v want %#v", want.name, gotIDs, identifiers)
			}
		}
	}
}
