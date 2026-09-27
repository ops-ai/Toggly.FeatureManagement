package togglytemplate

import (
	"bytes"
	"context"
	"html/template"
	"testing"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly"
)

type fakeEval struct{ on map[string]bool }

func (f fakeEval) IsEnabled(ctx context.Context, featureKey string, evalCtx toggly.Context) (bool, error) {
	_ = ctx
	_ = evalCtx
	return f.on[featureKey], nil
}

type pageData struct{ UserID string }

func (p pageData) TogglyContext() toggly.Context { return toggly.Context{Identity: p.UserID} }

func TestFuncMap_Feature(t *testing.T) {
	tpl := template.New("t").Funcs(FuncMap(fakeEval{on: map[string]bool{"A": true}}, nil))
	tpl, err := tpl.Parse(`{{ if (feature . "A") }}on{{ else }}off{{ end }}`)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}

	var buf bytes.Buffer
	if err := tpl.Execute(&buf, pageData{UserID: "u1"}); err != nil {
		t.Fatalf("exec: %v", err)
	}
	if got := buf.String(); got != "on" {
		t.Fatalf("expected on, got %q", got)
	}
}

func TestFuncMap_FeatureAnyAll(t *testing.T) {
	tpl := template.New("t").Funcs(FuncMap(fakeEval{on: map[string]bool{"B": true}}, nil))
	tpl, err := tpl.Parse(`{{ if (featureAny . "A" "B") }}any{{ end }}|{{ if (featureAll . "A" "B") }}all{{ end }}`)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}

	var buf bytes.Buffer
	if err := tpl.Execute(&buf, pageData{UserID: "u1"}); err != nil {
		t.Fatalf("exec: %v", err)
	}
	if got := buf.String(); got != "any|" {
		t.Fatalf("expected %q, got %q", "any|", got)
	}
}

func TestFuncMapEmptyAndCompleteGates(t *testing.T) {
	funcs := FuncMap(fakeEval{on: map[string]bool{"A": true, "B": true}}, nil)
	featureAny := funcs["featureAny"].(func(any, ...string) bool)
	featureAll := funcs["featureAll"].(func(any, ...string) bool)
	if featureAny(nil) || featureAll(nil) || !featureAny(nil, "A", "missing") || !featureAll(nil, "A", "B") || featureAll(nil, "A", "missing") {
		t.Fatal("featureAny/featureAll returned the wrong result for empty, complete, or mixed sets")
	}
	if funcs := FuncMap(nil, nil); funcs["feature"].(func(any, string) bool)(nil, "A") {
		t.Fatal("nil evaluator enabled a feature")
	}
}

func TestContextFromDataHandlesValuesPointersAndProviders(t *testing.T) {
	value := toggly.Context{Identity: "direct"}
	for _, tc := range []struct {
		data any
		want string
	}{
		{value, "direct"},
		{&value, "direct"},
		{(*toggly.Context)(nil), ""},
		{pageData{UserID: "provider"}, "provider"},
		{struct{}{}, ""},
	} {
		if got := ContextFromData(tc.data).Identity; got != tc.want {
			t.Errorf("ContextFromData(%T) = %q, want %q", tc.data, got, tc.want)
		}
	}
}
