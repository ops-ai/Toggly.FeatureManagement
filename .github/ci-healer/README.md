# CI Healer — Toggly.FeatureManagement

Hybrid CI healing for [`ops-ai/Toggly.FeatureManagement`](https://github.com/ops-ai/Toggly.FeatureManagement):

| Layer | Trigger | Runtime |
|-------|---------|---------|
| **Reactive** | `workflow_run` failure on any `analysis-*` workflow | GitHub Actions + [greencheck](https://github.com/braedonsaunders/greencheck) |
| **Daily sweep** | Cursor Automation cron `0 6 * * *` | Cursor Cloud Agent + Linear MCP |

Linear epic: **[OPS-274](https://linear.app/opsai/issue/OPS-274/ci-healer-togglyfeaturemanagement)**

## Files

| File | Purpose |
|------|---------|
| [ci-healer-instructions.md](./ci-healer-instructions.md) | Shared agent rules (both layers) |
| [ci-verify-map.yml](./ci-verify-map.yml) | Scoped local verify commands per workflow/job |
| [config.yml](./config.yml) | Rollout phase and watched workflow list |
| [report-to-linear.mjs](./report-to-linear.mjs) | Posts reactive run results to Linear |
| [../workflows/ci-healer.yml](../workflows/ci-healer.yml) | Reactive greencheck workflow |
| [../../.greencheck.yml](../../.greencheck.yml) | greencheck safety and cost limits |

---

## One-time setup

### 1. GitHub secrets

Add in **Settings → Secrets and variables → Actions → Secrets**:

| Secret | Required | Purpose |
|--------|----------|---------|
| `ANTHROPIC_API_KEY` | Yes | Claude API for greencheck |
| `LINEAR_API_KEY` | Yes | Linear GraphQL API for reactive reporting |
| `CI_HEALER_PAT` | Optional | PAT with `contents: write` + `actions: write` if `GITHUB_TOKEN` cannot push to protected branches |

Create a Linear API key at **Linear → Settings → API → Personal API keys**.

### 2. GitHub repository variables

Add in **Settings → Secrets and variables → Actions → Variables**:

| Variable | Value |
|----------|-------|
| `LINEAR_CI_HEALER_EPIC` | `OPS-274` |
| `CI_HEALER_DRY_RUN` | `false` |
| `CI_HEALER_LIVE` | `false` during Phase 2; `true` to enable live `ci-healer.yml` (Phase 3) |

### 3. Branch protection (direct push)

The healer pushes fixes directly to the failing branch. For `develop` / `main`:

- Allow GitHub Actions to bypass branch protection, **or**
- Set `CI_HEALER_PAT` from a machine user with bypass permission

If pushes fail with 403, add `CI_HEALER_PAT` and verify the token can push to protected branches.

### 4. Verify analysis workflows have `workflow_dispatch`

All 16 `analysis-*` workflows already declare `workflow_dispatch:`. greencheck uses this to re-trigger CI after a fix push (because `GITHUB_TOKEN` pushes do not always start new workflow runs).

---

## Rollout phases

### Phase 1 — Config only (complete when these files are merged)

- [ci-verify-map.yml](./ci-verify-map.yml) covers all 16 analysis workflows
- [report-to-linear.mjs](./report-to-linear.mjs) can be dry-tested locally:

```bash
export LINEAR_API_KEY="lin_api_..."
export LINEAR_CI_HEALER_EPIC="OPS-274"
export WORKFLOW_RUN_URL="https://github.com/ops-ai/Toggly.FeatureManagement/actions/runs/123"
export WORKFLOW_RUN_ID="123"
export WORKFLOW_RUN_NAME="Flutter SDK - Tests & Analysis"
export HEAD_BRANCH="develop"
export GREENCHECK_FIXED="false"
export CI_HEALER_DRY_RUN="true"
node .github/ci-healer/report-to-linear.mjs
```

### Phase 2 — Flutter dry-run

1. Ensure `CI_HEALER_LIVE` is **not** set (or `false`) so [ci-healer.yml](../workflows/ci-healer.yml) stays idle
2. Merge [ci-healer-phase2-flutter-dryrun.yml](../workflows/ci-healer-phase2-flutter-dryrun.yml) (Flutter only, `dry-run: true`)
3. Configure secrets `ANTHROPIC_API_KEY` and `LINEAR_API_KEY`
4. Trigger a known Flutter analysis failure
5. Confirm greencheck runs in dry-run (no push) and Linear receives a comment on `CI sweep YYYY-MM-DD — FeatureManagement`
6. Validate classification accuracy on 3+ failures before proceeding

### Phase 3 — Live (all workflows)

1. Set repository variable `CI_HEALER_LIVE` = `true`
2. Delete [ci-healer-phase2-flutter-dryrun.yml](../workflows/ci-healer-phase2-flutter-dryrun.yml) to avoid duplicate Flutter healing
3. Confirm [ci-healer.yml](../workflows/ci-healer.yml) lists all 16 analysis workflows
4. Confirm a fix commit lands on the branch and the failed workflow re-dispatches green
5. Confirm loop prevention: healer does not re-trigger on its own commits

Current [config.yml](./config.yml) documents `rollout_phase: 3`.

---

## Daily Cursor Automation (Phase 4)

Configure in **Cursor → Automations → New automation**:

| Setting | Value |
|---------|-------|
| **Name** | CI Healer daily sweep — FeatureManagement |
| **Trigger** | Schedule: `0 6 * * *` (daily 06:00 UTC) |
| **Repository** | `ops-ai/Toggly.FeatureManagement`, branch `develop` |
| **Tools** | Shell / `gh`, Linear MCP |
| **MCP** | Linear (authenticated) |

### Automation prompt

```
You are the CI Healer daily sweep agent for ops-ai/Toggly.FeatureManagement.

Read and follow .github/ci-healer/ci-healer-instructions.md and .github/ci-healer/ci-verify-map.yml in the repository.

Linear epic: OPS-274 (parent). Team: opsAI. Project: Toggly.

## Steps

1. Find or create today's Linear issue titled "CI sweep YYYY-MM-DD — FeatureManagement" with parent OPS-274. Set state In Progress.

2. List failed runs from the last 24 hours:
   gh run list --repo ops-ai/Toggly.FeatureManagement --status failure --limit 50 \
     --json databaseId,name,headBranch,conclusion,url,createdAt,workflowName

3. Filter to analysis workflows only (match names in .github/ci-healer/config.yml watched_workflows_all). Skip branches starting with ci-heal/. Skip runs already commented in today's Linear issue (look for ci-healer-processed run_id= markers).

4. For each remaining failure:
   a. Classify per ci-healer-instructions.md
   b. Checkout headBranch
   c. Run scoped verify from ci-verify-map.yml
   d. If fixable: fix, verify, commit, push
   e. Re-dispatch: gh workflow run "<workflow display name>" --ref <branch>
   f. Watch: gh run watch <new-run-id>
   g. Post a per-failure Linear comment using the template in ci-healer-instructions.md

5. Post a daily summary comment with counts (scanned, resolved, escalated, skipped).

6. Move the daily issue to In Review. Never mark Done unless explicitly asked.

## Rules

- Never edit Linear issue descriptions; use save_comment only.
- Never disable CI checks to pass.
- Bump version + CHANGELOG when changing publishable packages.
- Max 5 fix passes per failure cluster.
- Escalate Sonar-only, secret, and infra failures without pushing.
```

---

## Verification checklist

- [ ] Secrets `ANTHROPIC_API_KEY` and `LINEAR_API_KEY` configured
- [ ] Variable `LINEAR_CI_HEALER_EPIC` = `OPS-274`
- [ ] Flutter dry-run produces Linear comment without pushing
- [ ] Live run pushes fix and re-dispatched workflow passes
- [ ] Regression revert works (greencheck `revert-on-regression: true`)
- [ ] Healer ignores its own `CI Healer` workflow runs
- [ ] Daily Cursor Automation creates sweep issue and summary comment

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| greencheck push fails on `develop` | Add `CI_HEALER_PAT` with bypass permission |
| No follow-up CI after fix push | Ensure target workflow has `workflow_dispatch:` |
| Linear comment missing | Check `LINEAR_API_KEY` secret and `LINEAR_CI_HEALER_EPIC` variable |
| greencheck loops | Confirm `CI Healer` is excluded in workflow `if:` guard |
| iOS/Android failures not fixable locally | Classify human-needed; fix code only if error is obvious from logs |
| Cost limit hit | Increase `max-cost` in `.greencheck.yml` or narrow failure scope |

---

## Cost and safety

- **Cost cap:** `$5.00` per greencheck run (`.greencheck.yml`)
- **Max passes:** 5 fix/verify cycles
- **Timeout:** 45 minutes
- **Protected files:** lockfiles, `.env*`, secrets paths are never committed
- **Regression:** automatic revert on new failures after a fix commit
