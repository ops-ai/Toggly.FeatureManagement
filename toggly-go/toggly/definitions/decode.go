package definitions

import (
	"bytes"
	"encoding/json"
	"fmt"
)

// DecodeUnsignedDefinitions decodes the unsigned /definitions response.
func DecodeUnsignedDefinitions(b []byte) ([]FeatureDefinitionModel, error) {
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.UseNumber()
	var defs []FeatureDefinitionModel
	if err := dec.Decode(&defs); err != nil {
		return nil, fmt.Errorf("decode unsigned definitions: %w", err)
	}
	return defs, nil
}

// DecodeSignedDefinitions decodes the signed /definitions-signed response.
func DecodeSignedDefinitions(b []byte) (*SignedDefinitionsResponse, error) {
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.UseNumber()
	var env SignedDefinitionsResponse
	if err := dec.Decode(&env); err != nil {
		return nil, fmt.Errorf("decode signed definitions envelope: %w", err)
	}
	if len(env.Defs) == 0 {
		return nil, fmt.Errorf("decode signed definitions envelope: missing defs")
	}
	return &env, nil
}

// DecodeSignedDefsPayload decodes the raw Defs payload into definitions.
func DecodeSignedDefsPayload(raw json.RawMessage) ([]FeatureDefinitionModel, error) {
	return DecodeUnsignedDefinitions(raw)
}

// DecodeEvaluatedVariantDefsMap decodes evaluated-variants-signed `defs` object
// (map of feature key → evaluated variant).
func DecodeEvaluatedVariantDefsMap(raw json.RawMessage) (map[string]EvaluatedVariantDef, error) {
	if len(raw) == 0 {
		return nil, fmt.Errorf("decode evaluated variant defs: empty defs")
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var m map[string]EvaluatedVariantDef
	if err := dec.Decode(&m); err != nil {
		return nil, fmt.Errorf("decode evaluated variant defs: %w", err)
	}
	if m == nil {
		m = map[string]EvaluatedVariantDef{}
	}
	return m, nil
}
