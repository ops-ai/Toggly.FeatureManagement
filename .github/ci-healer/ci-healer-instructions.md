# CI Healer Agent Instructions

Shared rules for the reactive greencheck layer and the daily Cursor Automation sweep on `ops-ai/Toggly.FeatureManagement`.

Read [ci-verify-map.yml](./ci-verify-map.yml) before running any local verification.

## Classification

| Type | When | Action |
|------|------|--------|
| **Fixable** | Test failures, type errors, broken imports, missing files after core bump, CI path/config typos | Diagnose, fix, verify, push |
| **Flaky** | Network/registry timeouts, transient external blips | Re-dispatch workflow once; no code change |
| **Human-needed** | Secrets, Sonar policy-only gates, auth failures, infra outages, intentional breaking changes | Linear comment only; do not push |
| **Skip** | Release workflows, CodeQL, runs already tagged `ci-healer-processed` | No action |

## Fix discipline

- Minimal diff; match existing repo patterns and naming conventions.
- Never disable checks, skip tests, or weaken lint rules to pass CI.
- Never edit lockfiles unless the failure is explicitly a lockfile integrity issue and the fix is regenerating them via the package manager.
- If changing a **publishable package**, bump `version` and add a dated `CHANGELOG.md` entry under `Added` / `Changed` / `Fixed`.
- Maximum **5 fix passes** per failure cluster.
- On regression (new failures after a fix commit), revert the last fix commit and escalate.

## Verify discipline

1. Identify the failed workflow display name and job name from the GitHub Actions run.
2. Look up the matching entry in [ci-verify-map.yml](./ci-verify-map.yml).
3. Run only the scoped commands for that workflow/job.
4. Do **not** attempt to run all 15 analysis workflows locally.
5. Do **not** commit until scoped verify passes.
6. Skip SonarCloud, OWASP dependency-check, and summary-only jobs for local verify unless the failure is in a preceding build/test job.

## Push and re-verify

1. Commit with a clear message describing the fix.
2. Push directly to the failing branch (`headBranch`).
3. Re-dispatch the failed workflow: `gh workflow run "<workflow display name>" --ref <branch>`
4. Watch until complete: `gh run watch <run-id>`
5. Confirm conclusion is `success` before marking resolved.

## Out of scope (never auto-fix)

- `sdk-*-release` workflows
- `CodeQL` workflow
- SonarCloud quality-gate-only failures without an accompanying build/test error
- Expired or missing repository secrets
- iOS/Android simulator-only failures when the runner cannot reproduce locally (fix code if obvious; otherwise escalate)

## Linear documentation

Use `save_comment` (Cursor Automation) or rely on `report-to-linear.mjs` (reactive layer). **Never edit issue descriptions** for implementation notes.

### Per-failure comment template

```markdown
## Failure: {workflow} / {branch}

**Run:** {url}
**Job:** {job_name}
**Classification:** {Fixable|Flaky|Human-needed|Skip}

### Actions
1. ...
2. ...

### Commits
- {sha} — {summary}

### Outcome
Resolved | Escalated | No-op

<!-- ci-healer-processed run_id={run_id} -->
```

### Daily sweep summary template

```markdown
## Daily sweep summary — {date}

**Failures scanned:** {n}
**Resolved:** {n}
**Escalated:** {n}
**Skipped:** {n}
```

Move the daily sweep issue to **In Review** when the sweep completes. Never mark issues **Done** unless explicitly requested.

## Rollout phases

| Phase | Configuration |
|-------|---------------|
| 2 | [config.yml](./config.yml): `rollout_phase: 2`, `dry_run: true` — Flutter workflow only |
| 3 | [config.yml](./config.yml): `rollout_phase: 3`, `dry_run: false` — all 15 analysis workflows |
