//! MF-parity feature variant assignment.
//!
//! Assigns a variant locally from the definitions catalog, matching
//! `Microsoft.FeatureManagement` (`IVariantFeatureManager`) bit-for-bit for the
//! same feature definition, targeting context, and enabled state. See the
//! `variant-allocator-corpus` for the gold cases this module is verified
//! against, and the design doc for the full algorithm writeup:
//! `Toggly.wiki/Home/Engineering/Plans/2026-09-23-Catalog-Local-Backend-Variants-Design.md`.

use crate::context::EvalContext;
use crate::definitions::{Allocation, FeatureDefinition, StatusOverride};
use sha2::{Digest, Sha256};

/// Why a given variant (or lack thereof) was assigned.
///
/// Mirrors `Microsoft.FeatureManagement.VariantAssignmentReason`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum AssignmentReason {
    /// The assignment pipeline never ran (no variants defined at all).
    #[default]
    None,
    /// Assigned via a matching user allocation rule.
    User,
    /// Assigned via a matching group allocation rule.
    Group,
    /// Assigned via a matching percentile allocation bucket.
    Percentile,
    /// Assigned (or attempted) via `Allocation.DefaultWhenEnabled`.
    DefaultWhenEnabled,
    /// Assigned (or attempted) via `Allocation.DefaultWhenDisabled`.
    DefaultWhenDisabled,
}

impl AssignmentReason {
    /// Wire-format string matching the gold corpus / .NET enum names.
    pub fn as_str(&self) -> &'static str {
        match self {
            AssignmentReason::None => "None",
            AssignmentReason::User => "User",
            AssignmentReason::Group => "Group",
            AssignmentReason::Percentile => "Percentile",
            AssignmentReason::DefaultWhenEnabled => "DefaultWhenEnabled",
            AssignmentReason::DefaultWhenDisabled => "DefaultWhenDisabled",
        }
    }
}

impl std::fmt::Display for AssignmentReason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Result of assigning a variant for one feature + context.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct VariantAssignment {
    /// Assigned variant name, or `None` if no variant could be resolved.
    pub variant_name: Option<String>,

    /// The assigned variant's untyped configuration payload, or `None`.
    pub configuration_value: Option<serde_json::Value>,

    /// Effective enabled state after applying the variant's `StatusOverride`.
    pub enabled: bool,

    /// Why this variant (or lack thereof) was assigned.
    pub assignment_reason: AssignmentReason,
}

/// Assign a variant for `definition` given the feature's filter-evaluated
/// `filter_enabled` state and the targeting `context`.
///
/// `ignore_case` mirrors `Microsoft.FeatureManagement`'s
/// `TargetingEvaluationOptions.IgnoreCase` (default `false`): it is a
/// service-level assigner option, not part of the feature definition itself.
pub fn assign_variant(
    definition: &FeatureDefinition,
    filter_enabled: bool,
    context: &EvalContext,
    ignore_case: bool,
) -> VariantAssignment {
    // No variants defined at all: the assignment pipeline never runs.
    if definition.variants.is_empty() {
        return VariantAssignment {
            variant_name: None,
            configuration_value: None,
            enabled: filter_enabled,
            assignment_reason: AssignmentReason::None,
        };
    }

    let (variant_name, assignment_reason) = match &definition.allocation {
        None => (
            None,
            if filter_enabled {
                AssignmentReason::DefaultWhenEnabled
            } else {
                AssignmentReason::DefaultWhenDisabled
            },
        ),
        Some(allocation) => {
            if !filter_enabled {
                (
                    allocation.default_when_disabled.clone(),
                    AssignmentReason::DefaultWhenDisabled,
                )
            } else {
                resolve_enabled_allocation(
                    allocation,
                    &definition.feature_key,
                    context,
                    ignore_case,
                )
            }
        }
    };

    let variant = variant_name
        .as_deref()
        .and_then(|name| definition.variants.iter().find(|v| v.name == name));
    let configuration_value = variant.and_then(|v| v.configuration_value.clone());

    let mut enabled = filter_enabled;
    if let Some(v) = variant {
        match v.status_override {
            StatusOverride::Enabled => enabled = true,
            StatusOverride::Disabled => enabled = false,
            StatusOverride::None => {}
        }
    }

    VariantAssignment {
        variant_name,
        configuration_value,
        enabled,
        assignment_reason,
    }
}

/// User → group → percentile → `DefaultWhenEnabled`, in that precedence
/// order. Only reached when the feature's filters evaluated to enabled.
fn resolve_enabled_allocation(
    allocation: &Allocation,
    feature_key: &str,
    context: &EvalContext,
    ignore_case: bool,
) -> (Option<String>, AssignmentReason) {
    if let Some(user_id) = context.identity.as_deref().filter(|s| !s.is_empty()) {
        if let Some(rules) = &allocation.user {
            for rule in rules {
                if string_list_contains(&rule.users, user_id, ignore_case) {
                    return (Some(rule.variant.clone()), AssignmentReason::User);
                }
            }
        }
    }

    if let Some(rules) = &allocation.group {
        for rule in rules {
            if context
                .groups
                .iter()
                .any(|g| string_list_contains(&rule.groups, g, ignore_case))
            {
                return (Some(rule.variant.clone()), AssignmentReason::Group);
            }
        }
    }

    if let Some(rules) = &allocation.percentile {
        let user_id = context.identity.as_deref().unwrap_or("");
        let context_id = percentile_context_id(
            user_id,
            feature_key,
            allocation.seed.as_deref(),
            ignore_case,
        );
        let percentage = percentile_marker(&context_id);
        for rule in rules {
            if bucket_matches(percentage, rule.from, rule.to) {
                return (Some(rule.variant.clone()), AssignmentReason::Percentile);
            }
        }
    }

    (
        allocation.default_when_enabled.clone(),
        AssignmentReason::DefaultWhenEnabled,
    )
}

fn string_list_contains(candidates: &[String], value: &str, ignore_case: bool) -> bool {
    if ignore_case {
        candidates
            .iter()
            .any(|c| c.to_lowercase() == value.to_lowercase())
    } else {
        candidates.iter().any(|c| c == value)
    }
}

/// `from <= pct < to`, except `to == 100` is inclusive-from / unbounded-above
/// (matches `Microsoft.FeatureManagement.FeatureFilters.TargetingEvaluator`).
fn bucket_matches(percentage: f64, from: f64, to: f64) -> bool {
    if to >= 100.0 {
        percentage >= from
    } else {
        percentage >= from && percentage < to
    }
}

/// Build the percentile hash context id: `{userId}\n{hint}`, where `hint` is
/// the allocation's custom seed or the implicit default
/// `allocation\n{featureKey}`. `userId` is lowercased first when
/// `ignore_case` is set (MF lowercases the assigner's targeting id).
fn percentile_context_id(
    user_id: &str,
    feature_key: &str,
    seed: Option<&str>,
    ignore_case: bool,
) -> String {
    let user_id = if ignore_case {
        user_id.to_lowercase()
    } else {
        user_id.to_string()
    };
    match seed {
        Some(seed) => format!("{user_id}\n{seed}"),
        None => format!("{user_id}\nallocation\n{feature_key}"),
    }
}

/// SHA-256 over `context_id`; first 4 digest bytes as a little-endian
/// `uint32`, scaled to a `[0, 100]` percentage.
fn percentile_marker(context_id: &str) -> f64 {
    let mut hasher = Sha256::new();
    hasher.update(context_id.as_bytes());
    let digest = hasher.finalize();
    let marker = u32::from_le_bytes([digest[0], digest[1], digest[2], digest[3]]);
    (f64::from(marker) / f64::from(u32::MAX)) * 100.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::definitions::{
        GroupAllocation, PercentileAllocation, RequirementType, UserAllocation, Variant,
    };

    fn base_definition(
        variants: Vec<Variant>,
        allocation: Option<Allocation>,
    ) -> FeatureDefinition {
        FeatureDefinition {
            feature_key: "test-feature".to_string(),
            filters: vec![],
            metrics: vec![],
            secured_feature: false,
            client_sdk_enabled: true,
            requirement_type: RequirementType::Any,
            context_kind: None,
            context_requirement_type: None,
            variants,
            allocation,
        }
    }

    fn variant(name: &str, value: serde_json::Value, status_override: StatusOverride) -> Variant {
        Variant {
            name: name.to_string(),
            configuration_value: Some(value),
            status_override,
        }
    }

    #[test]
    fn no_variants_defined_reason_is_none() {
        let def = base_definition(vec![], None);
        let assignment = assign_variant(&def, true, &EvalContext::default(), false);
        assert_eq!(
            assignment,
            VariantAssignment {
                variant_name: None,
                configuration_value: None,
                enabled: true,
                assignment_reason: AssignmentReason::None,
            }
        );
    }

    #[test]
    fn no_allocation_still_reports_default_reason_without_variant() {
        let def = base_definition(
            vec![variant(
                "A",
                serde_json::json!({"x": 1}),
                StatusOverride::None,
            )],
            None,
        );
        let assignment = assign_variant(&def, true, &EvalContext::default(), false);
        assert_eq!(assignment.variant_name, None);
        assert_eq!(
            assignment.assignment_reason,
            AssignmentReason::DefaultWhenEnabled
        );
        assert!(assignment.enabled);
    }

    #[test]
    fn user_allocation_matches_before_default() {
        let def = base_definition(
            vec![
                variant(
                    "A",
                    serde_json::json!({"color": "blue"}),
                    StatusOverride::None,
                ),
                variant(
                    "B",
                    serde_json::json!({"color": "green"}),
                    StatusOverride::None,
                ),
            ],
            Some(Allocation {
                default_when_enabled: Some("B".to_string()),
                user: Some(vec![UserAllocation {
                    variant: "A".to_string(),
                    users: vec!["alice".to_string(), "bob".to_string()],
                }]),
                ..Allocation::default()
            }),
        );

        let ctx = EvalContext::with_identity("alice");
        let assignment = assign_variant(&def, true, &ctx, false);
        assert_eq!(assignment.variant_name, Some("A".to_string()));
        assert_eq!(
            assignment.configuration_value,
            Some(serde_json::json!({"color": "blue"}))
        );
        assert_eq!(assignment.assignment_reason, AssignmentReason::User);

        let ctx = EvalContext::with_identity("carol");
        let assignment = assign_variant(&def, true, &ctx, false);
        assert_eq!(assignment.variant_name, Some("B".to_string()));
        assert_eq!(
            assignment.assignment_reason,
            AssignmentReason::DefaultWhenEnabled
        );
    }

    #[test]
    fn group_allocation_matches_before_default() {
        let def = base_definition(
            vec![
                variant(
                    "A",
                    serde_json::json!({"show": false}),
                    StatusOverride::None,
                ),
                variant("B", serde_json::json!({"show": true}), StatusOverride::None),
            ],
            Some(Allocation {
                default_when_enabled: Some("A".to_string()),
                group: Some(vec![GroupAllocation {
                    variant: "B".to_string(),
                    groups: vec!["beta-testers".to_string()],
                }]),
                ..Allocation::default()
            }),
        );

        let ctx = EvalContext::builder().group("beta-testers").build();
        let assignment = assign_variant(&def, true, &ctx, false);
        assert_eq!(assignment.variant_name, Some("B".to_string()));
        assert_eq!(assignment.assignment_reason, AssignmentReason::Group);
    }

    #[test]
    fn percentile_to_100_edge_always_matches() {
        let def = base_definition(
            vec![variant(
                "A",
                serde_json::json!({"tier": "everyone"}),
                StatusOverride::None,
            )],
            Some(Allocation {
                percentile: Some(vec![PercentileAllocation {
                    variant: "A".to_string(),
                    from: 0.0,
                    to: 100.0,
                }]),
                ..Allocation::default()
            }),
        );

        let ctx = EvalContext::with_identity("any-user");
        let assignment = assign_variant(&def, true, &ctx, false);
        assert_eq!(assignment.variant_name, Some("A".to_string()));
        assert_eq!(assignment.assignment_reason, AssignmentReason::Percentile);
    }

    #[test]
    fn case_insensitive_user_allocation() {
        let def = base_definition(
            vec![
                variant(
                    "A",
                    serde_json::json!({"tag": "targeted"}),
                    StatusOverride::None,
                ),
                variant(
                    "B",
                    serde_json::json!({"tag": "default"}),
                    StatusOverride::None,
                ),
            ],
            Some(Allocation {
                default_when_enabled: Some("B".to_string()),
                user: Some(vec![UserAllocation {
                    variant: "A".to_string(),
                    users: vec!["User1".to_string()],
                }]),
                ..Allocation::default()
            }),
        );

        let ctx = EvalContext::with_identity("user1");
        let assignment = assign_variant(&def, true, &ctx, true);
        assert_eq!(assignment.variant_name, Some("A".to_string()));
        assert_eq!(assignment.assignment_reason, AssignmentReason::User);

        // Same inputs without ignore_case fall back to the default.
        let assignment = assign_variant(&def, true, &ctx, false);
        assert_eq!(assignment.variant_name, Some("B".to_string()));
        assert_eq!(
            assignment.assignment_reason,
            AssignmentReason::DefaultWhenEnabled
        );
    }

    #[test]
    fn status_override_enabled_flips_disabled_feature() {
        let def = base_definition(
            vec![variant(
                "Off",
                serde_json::json!({"killSwitch": true}),
                StatusOverride::Enabled,
            )],
            Some(Allocation {
                default_when_disabled: Some("Off".to_string()),
                ..Allocation::default()
            }),
        );

        let ctx = EvalContext::with_identity("jack");
        let assignment = assign_variant(&def, false, &ctx, false);
        assert_eq!(assignment.variant_name, Some("Off".to_string()));
        assert_eq!(
            assignment.assignment_reason,
            AssignmentReason::DefaultWhenDisabled
        );
        assert!(assignment.enabled);
    }

    #[test]
    fn status_override_disabled_flips_enabled_feature() {
        let def = base_definition(
            vec![variant(
                "On",
                serde_json::json!({"killSwitch": false}),
                StatusOverride::Disabled,
            )],
            Some(Allocation {
                default_when_enabled: Some("On".to_string()),
                ..Allocation::default()
            }),
        );

        let ctx = EvalContext::with_identity("kim");
        let assignment = assign_variant(&def, true, &ctx, false);
        assert_eq!(assignment.variant_name, Some("On".to_string()));
        assert_eq!(
            assignment.assignment_reason,
            AssignmentReason::DefaultWhenEnabled
        );
        assert!(!assignment.enabled);
    }

    #[test]
    fn disabled_feature_skips_user_group_percentile_rules() {
        let def = base_definition(
            vec![
                variant("A", serde_json::json!(1), StatusOverride::None),
                variant("B", serde_json::json!(2), StatusOverride::None),
            ],
            Some(Allocation {
                default_when_disabled: Some("B".to_string()),
                user: Some(vec![UserAllocation {
                    variant: "A".to_string(),
                    users: vec!["gina".to_string()],
                }]),
                ..Allocation::default()
            }),
        );

        let ctx = EvalContext::with_identity("gina");
        let assignment = assign_variant(&def, false, &ctx, false);
        assert_eq!(assignment.variant_name, Some("B".to_string()));
        assert_eq!(
            assignment.assignment_reason,
            AssignmentReason::DefaultWhenDisabled
        );
    }
}
