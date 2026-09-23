// Package variant implements catalog-local, Microsoft.FeatureManagement
// 4.7.0-parity variant allocation.
//
// The allocator is pure and side-effect free: it takes an already-decoded
// FeatureDefinitionModel plus the feature's already-computed filter-based
// enabled state (from the eval package) and a targeting context, and returns
// the assigned variant, the Microsoft.FeatureManagement-compatible assignment
// reason, and the effective enabled state after any variant StatusOverride is
// applied.
//
// This mirrors Microsoft.FeatureManagement.FeatureManager.GetVariantAsync:
//
//   - Feature disabled  → DefaultWhenDisabled only (no User/Group/Percentile).
//   - Feature enabled   → User → Group → Percentile → DefaultWhenEnabled.
//   - No Allocation     → no variant resolves, but the reason still reports
//     DefaultWhenEnabled/DefaultWhenDisabled (matching Microsoft.FeatureManagement).
//   - No Variants at all → assignment never runs; reason is "None".
//
// See variant-allocator-corpus/cases.json (repo root) for the gold corpus
// this package must replay bit-for-bit, and
// Toggly.wiki/Home/Engineering/Plans/2026-09-23-Catalog-Local-Backend-Variants-Design.md
// for the full algorithm writeup.
package variant

import (
	"crypto/sha256"
	"encoding/binary"
	"strings"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/definitions"
)

// Reason mirrors Microsoft.FeatureManagement.VariantAssignmentReason.
type Reason string

const (
	ReasonNone                Reason = "None"
	ReasonDefaultWhenDisabled Reason = "DefaultWhenDisabled"
	ReasonUser                Reason = "User"
	ReasonGroup               Reason = "Group"
	ReasonPercentile          Reason = "Percentile"
	ReasonDefaultWhenEnabled  Reason = "DefaultWhenEnabled"
)

// TargetingContext is the minimal targeting input for variant assignment,
// mirroring Microsoft.FeatureManagement.TargetingContext (UserId + Groups).
type TargetingContext struct {
	UserID string
	Groups []string
}

// Assignment is the outcome of Assign.
type Assignment struct {
	// Variant is the resolved variant definition, or nil when none was assigned
	// (e.g. no matching rule and no configured default, or Variants is empty).
	Variant *definitions.VariantDefinition

	// Reason is the Microsoft.FeatureManagement-compatible assignment reason.
	Reason Reason

	// Enabled is the effective enabled state after any assigned variant's
	// StatusOverride is applied. Equals baseEnabled when no variant is
	// assigned or the assigned variant's StatusOverride is None.
	Enabled bool
}

// Assign runs the Microsoft.FeatureManagement 4.7.0 variant-allocation
// algorithm against a single feature definition.
//
// baseEnabled is the feature's already-computed filter-based enabled state
// (e.g. from eval.Engine.Evaluate). ignoreCase controls user/group match
// case-sensitivity and the percentile hash's userId casing, mirroring
// Microsoft.FeatureManagement.FeatureFilters.TargetingEvaluationOptions.IgnoreCase
// (default false).
func Assign(def definitions.FeatureDefinitionModel, baseEnabled bool, targeting TargetingContext, ignoreCase bool) Assignment {
	if len(def.Variants) == 0 {
		return Assignment{Reason: ReasonNone, Enabled: baseEnabled}
	}

	var (
		variantName string
		reason      Reason
	)

	if !baseEnabled {
		reason = ReasonDefaultWhenDisabled
		if def.Allocation != nil && def.Allocation.DefaultWhenDisabled != nil {
			variantName = *def.Allocation.DefaultWhenDisabled
		}
	} else {
		reason = ReasonDefaultWhenEnabled
		if a := def.Allocation; a != nil {
			if v := matchUser(a.User, targeting.UserID, ignoreCase); v != "" {
				variantName, reason = v, ReasonUser
			} else if v := matchGroup(a.Group, targeting.Groups, ignoreCase); v != "" {
				variantName, reason = v, ReasonGroup
			} else if v := matchPercentile(a.Percentile, a.Seed, def.FeatureKey, targeting.UserID, ignoreCase); v != "" {
				variantName, reason = v, ReasonPercentile
			} else if a.DefaultWhenEnabled != nil {
				variantName = *a.DefaultWhenEnabled
			}
		}
	}

	result := Assignment{Reason: reason, Enabled: baseEnabled}
	if variantName == "" {
		return result
	}

	for i := range def.Variants {
		if def.Variants[i].Name != variantName {
			continue
		}
		v := def.Variants[i]
		result.Variant = &v
		switch v.StatusOverride {
		case definitions.StatusOverrideEnabled:
			result.Enabled = true
		case definitions.StatusOverrideDisabled:
			result.Enabled = false
		}
		break
	}
	return result
}

// matchUser returns the first User allocation's variant whose Users contains
// userID, or "" when there is no match (or userID is empty).
func matchUser(list []definitions.UserAllocation, userID string, ignoreCase bool) string {
	if userID == "" {
		return ""
	}
	for _, u := range list {
		if containsMatch(u.Users, userID, ignoreCase) {
			return u.Variant
		}
	}
	return ""
}

// matchGroup returns the first Group allocation's variant that overlaps with
// groups, or "" when there is no match.
func matchGroup(list []definitions.GroupAllocation, groups []string, ignoreCase bool) string {
	if len(groups) == 0 {
		return ""
	}
	for _, g := range list {
		for _, userGroup := range groups {
			if containsMatch(g.Groups, userGroup, ignoreCase) {
				return g.Variant
			}
		}
	}
	return ""
}

// matchPercentile returns the first Percentile bucket's variant containing
// the computed context percentage, or "" when there is no match.
func matchPercentile(list []definitions.PercentileAllocation, seed *string, featureKey, userID string, ignoreCase bool) string {
	if len(list) == 0 {
		return ""
	}

	hint := "allocation\n" + featureKey
	if seed != nil {
		hint = *seed
	}

	id := userID
	if ignoreCase {
		id = strings.ToLower(id)
	}

	pct := contextPercentage(id + "\n" + hint)
	for _, p := range list {
		if pct >= p.From && (p.To >= 100 || pct < p.To) {
			return p.Variant
		}
	}
	return ""
}

// contextPercentage hashes contextId per Microsoft.FeatureManagement's
// TargetingEvaluator: SHA-256, first 4 bytes interpreted as a little-endian
// uint32, scaled to [0, 100].
func contextPercentage(contextID string) float64 {
	sum := sha256.Sum256([]byte(contextID))
	value := binary.LittleEndian.Uint32(sum[:4])
	return (float64(value) / float64(0xFFFFFFFF)) * 100
}

// containsMatch reports whether list contains val, honoring ignoreCase
// (Microsoft.FeatureManagement.FeatureFilters.TargetingEvaluationOptions.IgnoreCase).
func containsMatch(list []string, val string, ignoreCase bool) bool {
	for _, s := range list {
		if ignoreCase {
			if strings.EqualFold(s, val) {
				return true
			}
			continue
		}
		if s == val {
			return true
		}
	}
	return false
}
