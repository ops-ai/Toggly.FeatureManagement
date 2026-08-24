package toggly

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

type order struct {
	ID    string
	Color string
}

func resetEntityContextState() {
	entityMu.Lock()
	defer entityMu.Unlock()
	entityMappers = map[string]entityMapper{}
	entitySchemas = map[string]EntityContextSchemaRegistration{}
}

func TestRegisterContextAndMapEntity(t *testing.T) {
	t.Cleanup(resetEntityContextState)
	resetEntityContextState()

	RegisterContext("Order", func(v any) EntityContext {
		o := v.(order)
		return EntityContext{Kind: "Order", Key: o.ID, Attributes: map[string]any{"color": o.Color}}
	}, &EntityContextSchemaRegistration{
		KeyProperty: "id",
		Properties:  []EntityContextPropertySchema{{Name: "color", Type: "string"}},
	})

	mapped := MapEntity("Order", order{ID: "1", Color: "red"})
	if mapped == nil || mapped.Key != "1" || mapped.Attributes["color"] != "red" {
		t.Fatalf("mapped=%#v", mapped)
	}
	if MapEntity("Missing", order{ID: "1"}) != nil {
		t.Fatal("expected nil for unknown kind")
	}
	regs := getEntitySchemas()
	if len(regs) != 1 || regs[0].Kind != "Order" || regs[0].DisplayName != "Order" {
		t.Fatalf("schemas=%#v", regs)
	}
}

func TestRegisterEntityContextsAtStartupSkip(t *testing.T) {
	t.Cleanup(resetEntityContextState)
	resetEntityContextState()
	RegisterContext("Order", nil, &EntityContextSchemaRegistration{KeyProperty: "id"})

	registerEntityContextsAtStartup(Config{DisableEntityContextRegistration: true, AppKey: "app"})
	registerEntityContextsAtStartup(Config{AppKey: ""})
}

func TestRegisterEntityContextsAtStartupPut(t *testing.T) {
	t.Cleanup(resetEntityContextState)
	resetEntityContextState()
	RegisterContext("Order", nil, &EntityContextSchemaRegistration{KeyProperty: "id"})

	var gotPath string
	var body []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		body, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()

	registerEntityContextsAtStartup(Config{AppKey: "app", BaseURL: srv.URL + "/"})
	if gotPath != "/sdk/app/contexts" {
		t.Fatalf("path=%s", gotPath)
	}
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatal(err)
	}
	contexts, _ := payload["contexts"].([]any)
	if len(contexts) != 1 {
		t.Fatalf("payload=%s", body)
	}
}

func TestRegisterEntityContextsAtStartupSwallowsErrors(t *testing.T) {
	t.Cleanup(resetEntityContextState)
	resetEntityContextState()
	RegisterContext("Order", nil, &EntityContextSchemaRegistration{KeyProperty: "id"})

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "nope", http.StatusInternalServerError)
	}))
	defer srv.Close()

	registerEntityContextsAtStartup(Config{AppKey: "app", BaseURL: srv.URL + "/"})
	registerEntityContextsAtStartup(Config{AppKey: "app", BaseURL: "http://127.0.0.1:1/"})
}
