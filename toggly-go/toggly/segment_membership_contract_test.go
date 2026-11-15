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

const (
	segmentMembershipContractRel = "tests/segment-membership/contract.json"
	segmentAPIBasePath           = "/api/v2/segments"
	segmentAPIItemsPath          = "/api/v2/segments/beta/items"
	segmentAuthHeader            = "Authorization"
	segmentTestAppKey            = "backend-key"
	segmentTestListID            = "beta"
)

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

type contractRequest struct {
	Method, Path, Auth string
	Body               map[string]any
}

type contractRoute struct {
	Method string
	Path   string
}

func firstExistingFile(paths []string) string {
	for _, candidate := range paths {
		if _, err := os.Stat(candidate); err == nil {
			if abs, err := filepath.Abs(candidate); err == nil {
				return abs
			}
			return candidate
		}
	}
	return ""
}

func walkForFile(start, rel string, maxDepth int) string {
	walk := start
	for i := 0; i < maxDepth; i++ {
		candidate := filepath.Join(walk, rel)
		if _, err := os.Stat(candidate); err == nil {
			if abs, err := filepath.Abs(candidate); err == nil {
				return abs
			}
			return candidate
		}
		parent := filepath.Dir(walk)
		if parent == walk {
			break
		}
		walk = parent
	}
	return ""
}

func resolveSegmentMembershipContract(t *testing.T) string {
	t.Helper()
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	candidates := []string{
		filepath.Join(cwd, segmentMembershipContractRel),
		filepath.Join(cwd, "..", segmentMembershipContractRel),
		filepath.Join(cwd, "..", "..", segmentMembershipContractRel),
		filepath.Join(cwd, "..", "..", "..", segmentMembershipContractRel),
	}
	if found := firstExistingFile(candidates); found != "" {
		return found
	}
	if found := walkForFile(cwd, segmentMembershipContractRel, 6); found != "" {
		return found
	}
	t.Fatal(segmentMembershipContractRel + " not found")
	return ""
}

func loadSegmentMembershipContract(t *testing.T) segmentMembershipContract {
	t.Helper()
	data, err := os.ReadFile(resolveSegmentMembershipContract(t))
	if err != nil {
		t.Fatalf("read contract: %v", err)
	}
	var contract segmentMembershipContract
	if err := json.Unmarshal(data, &contract); err != nil {
		t.Fatalf("parse contract: %v", err)
	}
	return contract
}

func assertContractShape(t *testing.T, contract segmentMembershipContract) map[string]contractRoute {
	t.Helper()
	if contract.SchemaVersion != 1 {
		t.Fatalf("unexpected schemaVersion %d", contract.SchemaVersion)
	}
	if contract.BasePath != segmentAPIBasePath {
		t.Fatalf("unexpected basePath %q", contract.BasePath)
	}
	if contract.Auth.Header != segmentAuthHeader {
		t.Fatalf("unexpected auth header %q", contract.Auth.Header)
	}

	routeByName := map[string]contractRoute{}
	for _, route := range contract.Routes {
		routeByName[route.Name] = contractRoute{Method: route.Method, Path: route.Path}
	}
	for _, name := range []string{"listSegments", "addSegmentMembers", "removeSegmentMembers", "replaceSegmentMembers"} {
		if _, ok := routeByName[name]; !ok {
			t.Fatalf("contract missing route %s", name)
		}
	}
	return routeByName
}

func newSegmentMembershipContractServer(t *testing.T, seen *[]contractRequest) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if r.Body != nil && r.ContentLength != 0 {
			_ = json.NewDecoder(r.Body).Decode(&body)
		}
		*seen = append(*seen, contractRequest{
			Method: r.Method,
			Path:   r.URL.Path,
			Auth:   r.Header.Get(segmentAuthHeader),
			Body:   body,
		})
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodGet && r.URL.Path == segmentAPIBasePath {
			_, _ = w.Write([]byte(`[]`))
			return
		}
		_, _ = w.Write([]byte(`{}`))
	}))
}

func exerciseSegmentMembershipClient(t *testing.T, client SegmentMembershipClient, identifiers []string) {
	t.Helper()
	if _, err := client.ListSegments(); err != nil {
		t.Fatalf("ListSegments: %v", err)
	}
	if _, err := client.AddSegmentMembers(segmentTestListID, identifiers); err != nil {
		t.Fatalf("AddSegmentMembers: %v", err)
	}
	if _, err := client.RemoveSegmentMembers(segmentTestListID, identifiers); err != nil {
		t.Fatalf("RemoveSegmentMembers: %v", err)
	}
	if _, err := client.ReplaceSegmentMembers(segmentTestListID, identifiers); err != nil {
		t.Fatalf("ReplaceSegmentMembers: %v", err)
	}
}

func assertContractRequests(t *testing.T, seen []contractRequest, routeByName map[string]contractRoute, identifiers []string) {
	t.Helper()
	expect := []struct {
		name    string
		method  string
		path    string
		hasBody bool
	}{
		{"listSegments", routeByName["listSegments"].Method, segmentAPIBasePath, false},
		{"addSegmentMembers", routeByName["addSegmentMembers"].Method, segmentAPIItemsPath, true},
		{"removeSegmentMembers", routeByName["removeSegmentMembers"].Method, segmentAPIItemsPath, true},
		{"replaceSegmentMembers", routeByName["replaceSegmentMembers"].Method, segmentAPIItemsPath, true},
	}
	if len(seen) != len(expect) {
		t.Fatalf("saw %d requests, want %d", len(seen), len(expect))
	}
	wantIDs := strings.Join(identifiers, ",")
	for i, want := range expect {
		got := seen[i]
		if !strings.EqualFold(got.Method, want.method) {
			t.Fatalf("%s: method %s want %s", want.name, got.Method, want.method)
		}
		if got.Path != want.path {
			t.Fatalf("%s: path %s want %s", want.name, got.Path, want.path)
		}
		if got.Auth != segmentTestAppKey {
			t.Fatalf("%s: Authorization %q", want.name, got.Auth)
		}
		if !want.hasBody {
			continue
		}
		raw, _ := json.Marshal(got.Body["identifiers"])
		var gotIDs []string
		_ = json.Unmarshal(raw, &gotIDs)
		if strings.Join(gotIDs, ",") != wantIDs {
			t.Fatalf("%s: identifiers %#v want %#v", want.name, gotIDs, identifiers)
		}
	}
}

func TestSegmentMembershipContractRoutes(t *testing.T) {
	contract := loadSegmentMembershipContract(t)
	routeByName := assertContractShape(t, contract)

	var seen []contractRequest
	server := newSegmentMembershipContractServer(t, &seen)
	defer server.Close()

	client := SegmentMembershipClient{AppKey: segmentTestAppKey, BaseURL: server.URL, HTTP: server.Client()}
	identifiers := contract.Body.Identifiers
	if len(identifiers) == 0 {
		identifiers = []string{"user-123"}
	}

	exerciseSegmentMembershipClient(t, client, identifiers)
	assertContractRequests(t, seen, routeByName, identifiers)
}
