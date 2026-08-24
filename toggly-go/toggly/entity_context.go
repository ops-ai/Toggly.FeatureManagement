package toggly

import (
	"bytes"
	"encoding/json"
	"net/http"
	"sync"
	"time"
)

// EntityContext is the canonical entity instance for ContextProperty filters.
type EntityContext struct {
	Kind       string
	Key        string
	Attributes map[string]any
}

// EntityContextPropertySchema describes a dashboard catalog property.
type EntityContextPropertySchema struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

// EntityContextSchemaRegistration is posted to sdk/{appKey}/contexts.
type EntityContextSchemaRegistration struct {
	Kind        string                        `json:"kind"`
	KeyProperty string                        `json:"keyProperty"`
	DisplayName string                        `json:"displayName,omitempty"`
	Properties  []EntityContextPropertySchema `json:"properties"`
}

type entityMapper func(any) EntityContext

var (
	entityMu      sync.RWMutex
	entityMappers = map[string]entityMapper{}
	entitySchemas = map[string]EntityContextSchemaRegistration{}
)

// RegisterContext registers a mapper and optional schema for a kind.
func RegisterContext(kind string, mapper func(any) EntityContext, schema *EntityContextSchemaRegistration) {
	entityMu.Lock()
	defer entityMu.Unlock()
	if mapper != nil {
		entityMappers[kind] = mapper
	}
	if schema != nil {
		s := *schema
		s.Kind = kind
		if s.DisplayName == "" {
			s.DisplayName = kind
		}
		entitySchemas[kind] = s
	}
}

// MapEntity maps a domain object through the mapper registered for kind.
func MapEntity(kind string, entity any) *EntityContext {
	entityMu.RLock()
	mapper, ok := entityMappers[kind]
	entityMu.RUnlock()
	if !ok {
		return nil
	}
	ctx := mapper(entity)
	return &ctx
}

func getEntitySchemas() []EntityContextSchemaRegistration {
	entityMu.RLock()
	defer entityMu.RUnlock()
	out := make([]EntityContextSchemaRegistration, 0, len(entitySchemas))
	for _, s := range entitySchemas {
		out = append(out, s)
	}
	return out
}

func registerEntityContextsAtStartup(cfg Config) {
	if cfg.DisableEntityContextRegistration {
		return
	}
	if cfg.AppKey == "" {
		return
	}
	regs := getEntitySchemas()
	if len(regs) == 0 {
		return
	}
	payload, err := json.Marshal(map[string]any{"contexts": regs})
	if err != nil {
		return
	}
	url := cfg.BaseURL + "sdk/" + cfg.AppKey + "/contexts"
	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequest(http.MethodPut, url, bytes.NewReader(payload))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return
	}
	_ = resp.Body.Close()
}
