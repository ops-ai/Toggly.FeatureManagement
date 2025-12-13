package toggly

import "github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/definitions"

func shouldUseSession(def definitions.FeatureDefinitionModel) bool {
	// Percentage and Targeting are deterministic in the Go SDK; session stickiness
	// is primarily useful for custom non-deterministic filters.
	return false
}

func hasFilter(def definitions.FeatureDefinitionModel, name string) bool {
	for _, f := range def.Filters {
		if f.Name == name {
			return true
		}
	}
	return false
}
