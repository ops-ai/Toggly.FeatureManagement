package toggly

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/definitions"
	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/snapshot"
)

func TestVariantInitialContext(t *testing.T) {
	groups := []string{" beta ", "team &東京", ""}
	claims := map[string]string{"plan&name": "pro + 東京", "": "bad", "empty": ""}
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		q := r.URL.Query()
		if q.Get("userId") != "user&123" || !reflect.DeepEqual(q["g"], []string{"beta", "team &東京"}) || q.Get("claim.plan&name") != "pro + 東京" {
			t.Errorf("unexpected initial query: %v", q)
		}
		if q.Has("claim.") || q.Has("claim.empty") {
			t.Errorf("empty claim sent: %v", q)
		}
		fmt.Fprint(w, `{"defs":{"f":{"enabled":true,"variant":"initial"}},"timestamp":100}`)
	}))
	defer srv.Close()
	c, err := NewClient(Config{AppKey: "app", Environment: "env", DefinitionsURL: srv.URL + "/", DisableBackgroundRefresh: true, EnableVariants: true, VariantIdentity: "user&123", VariantGroups: groups, VariantClaims: claims})
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	groups[0] = "mutated"
	claims["plan&name"] = "mutated"
	if err := c.provider.refresh(context.Background(), time.Second, false); err != nil {
		t.Fatal(err)
	}
	if calls != 1 || c.GetVariant("f").Name != "initial" {
		t.Fatalf("calls=%d variant=%v", calls, c.GetVariant("f"))
	}
}

func TestVariantSnapshotContextAndIdentityChange(t *testing.T) {
	store := snapshot.NewMemoryProvider()
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Header.Get("If-None-Match") != "" {
			t.Errorf("foreign context validator: %s", r.Header.Get("If-None-Match"))
		}
		w.Header().Set("ETag", `"same"`)
		fmt.Fprintf(w, `{"defs":{"f":{"enabled":true,"variant":%q}},"timestamp":100}`, r.URL.Query().Get("userId")+r.URL.Query().Get("g"))
	}))
	defer srv.Close()
	cfg := Config{AppKey: "app", Environment: "env", DefinitionsURL: srv.URL + "/", EnableVariants: true, VariantIdentity: "one", VariantGroups: []string{"a"}}
	p := newDefinitionsProvider(cfg, store)
	if err := p.refresh(context.Background(), time.Second, false); err != nil {
		t.Fatal(err)
	}
	cfg.VariantGroups = []string{"b"}
	other := newDefinitionsProvider(cfg, store)
	if err := other.refresh(context.Background(), time.Second, false); err != nil {
		t.Fatal(err)
	}
	if other.getVariant("f").Name != "oneb" {
		t.Fatal("group context reused old payload")
	}
	other.setVariantIdentity("two")
	if other.getVariant("f") != nil {
		t.Fatal("old variant survives identity change")
	}
	if err := other.refresh(context.Background(), time.Second, false); err != nil {
		t.Fatal(err)
	}
	if other.getVariant("f").Name != "twob" || calls != 3 {
		t.Fatalf("same revision not applied: %v calls=%d", other.getVariant("f"), calls)
	}
}

type delayedVariantSnapshot struct {
	*snapshot.MemoryProvider
	entered chan struct{}
	release chan struct{}
}

func (s *delayedVariantSnapshot) LoadDefinitions(ctx context.Context) (*snapshot.DefinitionsSnapshot, error) {
	close(s.entered)
	<-s.release
	return s.MemoryProvider.LoadDefinitions(ctx)
}

func TestVariantBackgroundStartupCopiesBeforeStorage(t *testing.T) {
	store := &delayedVariantSnapshot{snapshot.NewMemoryProvider(), make(chan struct{}), make(chan struct{})}
	requests := make(chan string, 2)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests <- r.URL.RawQuery
		fmt.Fprint(w, `{"defs":{},"timestamp":100}`)
	}))
	defer srv.Close()
	groups, claims := []string{"beta"}, map[string]string{"plan": "pro"}
	c, err := NewClient(Config{AppKey: "app", DefinitionsURL: srv.URL + "/", RefreshInterval: time.Hour, EnableVariants: true, VariantIdentity: "user", VariantGroups: groups, VariantClaims: claims, SnapshotProvider: store})
	if err != nil {
		t.Fatal(err)
	}
	<-store.entered
	groups[0], claims["plan"] = "changed", "changed"
	close(store.release)
	select {
	case raw := <-requests:
		q, err := url.ParseQuery(raw)
		if err != nil || q.Get("g") != "beta" || q.Get("claim.plan") != "pro" || q.Get("userId") != "user" {
			t.Fatalf("startup context: %s %v", raw, err)
		}
	case <-time.After(time.Second):
		t.Fatal("no initial request")
	}
	// Closing waits for the initial refresh to finish; no timer or second init fetch.
	if err := c.Close(); err != nil {
		t.Fatal(err)
	}
	if len(requests) != 0 {
		t.Fatal("extra initialization request")
	}
}

func TestVariantEmptyAndClaimLimit(t *testing.T) {
	for _, explicit := range []bool{false, true} {
		t.Run(fmt.Sprint(explicit), func(t *testing.T) {
			cfg := Config{AppKey: "app", EnableVariants: true}
			if explicit {
				cfg.VariantGroups = []string{}
				cfg.VariantClaims = map[string]string{}
			}
			p := newDefinitionsProvider(cfg, nil)
			if strings.Contains(p.variantURLLocked(), "?") {
				t.Fatal("empty context emitted query")
			}
		})
	}
	claims := map[string]string{"": "ignored", "empty": ""}
	for i := 24; i >= 0; i-- {
		claims[fmt.Sprintf("k%02d", i)] = "value"
	}
	p := newDefinitionsProvider(Config{AppKey: "app", VariantClaims: claims}, nil)
	u, _ := url.Parse(p.variantURLLocked())
	if len(u.Query()) != 20 || u.Query().Get("claim.k00") != "value" || u.Query().Has("claim.k20") {
		t.Fatalf("wrong cap: %v", u.Query())
	}
}

func TestVariantSnapshotOwnership(t *testing.T) {
	base := Config{AppKey: "app", Environment: "env", EnableVariants: true, VariantIdentity: "user", VariantGroups: []string{"a&b"}, VariantClaims: map[string]string{"plan": "pro"}}
	original := newDefinitionsProvider(base, nil)
	store := snapshot.NewMemoryProvider()
	saved := snapshot.DefinitionsSnapshot{VariantContext: original.variantContextKeyLocked(), VariantDefs: map[string]definitions.EvaluatedVariantDef{"f": {Enabled: true, Variant: "cached"}}, ETag: `"same"`, VariantTimestamp: 100}
	if err := store.SaveDefinitions(context.Background(), saved); err != nil {
		t.Fatal(err)
	}
	for _, change := range []string{"match", "groups", "claims", "identity", "delimiter", "app", "environment", "legacy"} {
		t.Run(change, func(t *testing.T) {
			cfg := base
			switch change {
			case "groups":
				cfg.VariantGroups = []string{}
			case "claims":
				cfg.VariantClaims = map[string]string{"plan": "free"}
			case "identity":
				cfg.VariantIdentity = "other"
			case "delimiter":
				cfg.VariantGroups = []string{"a", "b"}
			case "app":
				cfg.AppKey = "other"
			case "environment":
				cfg.Environment = "other"
			}
			source := store
			if change == "legacy" {
				source = snapshot.NewMemoryProvider()
				legacy := saved
				legacy.VariantContext = ""
				_ = source.SaveDefinitions(context.Background(), legacy)
			}
			p := newDefinitionsProvider(cfg, source)
			loaded, err := p.loadSnapshot(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			if loaded != (change == "match") {
				t.Fatalf("loaded=%v", loaded)
			}
			if !loaded && (p.getVariant("f") != nil || p.getDefinitionsRevision() != "") {
				t.Fatal("foreign payload/revision loaded")
			}
		})
	}
}

func TestVariantInFlightIdentityChangeDiscardsResponse(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(entered)
		<-release
		fmt.Fprint(w, `{"defs":{"f":{"enabled":true,"variant":"old"}},"timestamp":100}`)
	}))
	defer srv.Close()
	p := newDefinitionsProvider(Config{AppKey: "app", DefinitionsURL: srv.URL + "/", EnableVariants: true, VariantIdentity: "a"}, nil)
	done := make(chan error, 1)
	go func() { done <- p.refresh(context.Background(), time.Second, false) }()
	<-entered
	p.setVariantIdentity("b")
	p.setVariantIdentity("a") // Even an ABA transition invalidates the pending response.
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if p.getVariant("f") != nil || p.getDefinitionsRevision() != "" {
		t.Fatal("stale in-flight response applied")
	}
}

func TestVariantMatchingSnapshotReusesValidator(t *testing.T) {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Header.Get("If-None-Match") != `"same"` {
			t.Errorf("matching validator missing: %v", r.Header)
		}
		w.WriteHeader(http.StatusNotModified)
	}))
	defer srv.Close()
	cfg := Config{AppKey: "app", DefinitionsURL: srv.URL + "/", EnableVariants: true, VariantIdentity: "user", VariantClaims: map[string]string{"plan": "pro"}}
	store := snapshot.NewMemoryProvider()
	p := newDefinitionsProvider(cfg, store)
	_ = store.SaveDefinitions(context.Background(), snapshot.DefinitionsSnapshot{VariantContext: p.variantContextKeyLocked(), VariantDefs: map[string]definitions.EvaluatedVariantDef{"f": {Enabled: true, Variant: "cached"}}, ETag: `"same"`, VariantTimestamp: 100})
	if err := p.refresh(context.Background(), time.Second, false); err != nil {
		t.Fatal(err)
	}
	if calls != 1 || p.getVariant("f").Name != "cached" {
		t.Fatal("matching cache lost")
	}
	// A remote evaluated snapshot cannot supply global boolean definitions.
	cfg.EnableVariants = false
	local := newDefinitionsProvider(cfg, store)
	loaded, err := local.loadSnapshot(context.Background())
	if err != nil || loaded {
		t.Fatalf("variant snapshot loaded globally: %v %v", loaded, err)
	}
}

func TestVariantIdentityChangeDuringSnapshotLoad(t *testing.T) {
	store := &delayedVariantSnapshot{snapshot.NewMemoryProvider(), make(chan struct{}), make(chan struct{})}
	p := newDefinitionsProvider(Config{AppKey: "app", EnableVariants: true, VariantIdentity: "old"}, store)
	_ = store.SaveDefinitions(context.Background(), snapshot.DefinitionsSnapshot{VariantContext: p.variantContextKeyLocked(), VariantDefs: map[string]definitions.EvaluatedVariantDef{"f": {Variant: "old"}}, ETag: `"old"`})
	done := make(chan bool, 1)
	go func() { loaded, _ := p.loadSnapshot(context.Background()); done <- loaded }()
	<-store.entered
	p.setVariantIdentity("new")
	close(store.release)
	if <-done || p.getVariant("f") != nil || p.getDefinitionsRevision() != "" {
		t.Fatal("stale delayed snapshot applied")
	}
}
