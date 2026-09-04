//! Golden filter-parity fixtures from docs/filter-parity/fixtures/.

use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use toggly::definitions::{FeatureDefinition, FeatureFilter, RequirementType};
use toggly::eval::Engine;
use toggly::{EvalContext, HttpRequestMapper};

const REQUIRED_IDS: &[&str] = &[
    "browser-family-match",
    "browser-family-miss",
    "browser-language-match",
    "country-from-request",
    "country-from-cf-ipcountry",
    "device-type-match",
    "os-match",
    "user-claims-match",
    "user-claims-miss",
    "targeting-groups-match",
    "percentage-missing-fail-closed",
    "percentage-zero-fail-closed",
    "unknown-filter-fail-closed",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureRoot {
    id: String,
    feature_key: String,
    #[serde(default)]
    requirement_type: Option<String>,
    #[serde(default)]
    filters: Vec<FixtureFilter>,
    #[serde(default)]
    context: Option<serde_json::Value>,
    #[serde(default)]
    http_headers: Option<HashMap<String, String>>,
    expected: bool,
}

#[derive(Debug, Deserialize)]
struct FixtureFilter {
    name: String,
    #[serde(default)]
    parameters: HashMap<String, serde_json::Value>,
}

fn resolve_fixtures_dir() -> Option<PathBuf> {
    let cwd = std::env::current_dir().ok()?;
    let candidates = [
        cwd.join("docs/filter-parity/fixtures"),
        cwd.join("../docs/filter-parity/fixtures"),
        cwd.join("../../docs/filter-parity/fixtures"),
        cwd.join("../../../docs/filter-parity/fixtures"),
    ];
    for candidate in candidates {
        if candidate.is_dir() {
            return Some(candidate);
        }
    }

    let mut walk = cwd;
    for _ in 0..6 {
        let candidate = walk.join("docs/filter-parity/fixtures");
        if candidate.is_dir() {
            return Some(candidate);
        }
        if !walk.pop() {
            break;
        }
    }
    None
}

fn load_fixtures() -> Vec<(String, FixtureRoot)> {
    let directory = resolve_fixtures_dir().expect("docs/filter-parity/fixtures not found");
    let mut fixtures = Vec::new();
    let mut entries: Vec<_> = fs::read_dir(&directory)
        .unwrap_or_else(|e| panic!("read fixtures dir {}: {e}", directory.display()))
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|ext| ext.to_str()) == Some("json"))
        .collect();
    entries.sort();
    for path in entries {
        fixtures.push(load_fixture(&path));
    }
    fixtures
}

fn load_fixture(path: &Path) -> (String, FixtureRoot) {
    let text = fs::read_to_string(path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    let root: FixtureRoot =
        serde_json::from_str(&text).unwrap_or_else(|e| panic!("parse {}: {e}", path.display()));
    (root.id.clone(), root)
}

fn to_definition(root: &FixtureRoot) -> FeatureDefinition {
    let requirement_type = match root
        .requirement_type
        .as_deref()
        .unwrap_or("Any")
        .to_ascii_lowercase()
        .as_str()
    {
        "all" => RequirementType::All,
        _ => RequirementType::Any,
    };
    FeatureDefinition {
        feature_key: root.feature_key.clone(),
        filters: root
            .filters
            .iter()
            .map(|f| FeatureFilter {
                name: f.name.clone(),
                parameters: f.parameters.clone(),
            })
            .collect(),
        metrics: vec![],
        secured_feature: false,
        client_sdk_enabled: true,
        requirement_type,
        context_kind: None,
        context_requirement_type: None,
    }
}

fn to_context(root: &FixtureRoot) -> EvalContext {
    let base = match &root.context {
        Some(value) => serde_json::from_value::<EvalContext>(value.clone())
            .unwrap_or_else(|e| panic!("fixture {} context parse: {e}", root.id)),
        None => EvalContext::default(),
    };
    match &root.http_headers {
        Some(headers) if !headers.is_empty() => {
            HttpRequestMapper::merge_into(headers.iter().map(|(k, v)| (k.as_str(), v.as_str())), Some(&base))
        }
        _ => base,
    }
}

#[test]
fn loads_required_wave1_cases() {
    let ids: HashSet<_> = load_fixtures().into_iter().map(|(id, _)| id).collect();
    for required in REQUIRED_IDS {
        assert!(
            ids.contains(*required),
            "missing fixture {required}"
        );
    }
}

#[test]
fn golden_fixtures_match_expected() {
    let engine = Engine::with_defaults();
    for (fixture_id, root) in load_fixtures() {
        let definition = to_definition(&root);
        let context = to_context(&root);
        let actual = engine
            .evaluate(&definition, &context)
            .unwrap_or_else(|e| panic!("fixture {fixture_id} evaluate error: {e}"));
        assert_eq!(
            actual, root.expected,
            "fixture {fixture_id} failed (expected {}, got {actual})",
            root.expected
        );
    }
}
