# CI Healer — GitHub setup checklist

Complete these steps in the GitHub repository settings before enabling the reactive healer.

Repository: https://github.com/ops-ai/Toggly.FeatureManagement

## Secrets (Settings → Secrets and variables → Actions → Secrets)

- [ ] `ANTHROPIC_API_KEY` — Claude API key for greencheck
- [ ] `LINEAR_API_KEY` — Linear personal API key
- [ ] `CI_HEALER_PAT` (optional) — machine-user PAT if protected-branch push fails

## Variables (Settings → Secrets and variables → Actions → Variables)

- [ ] `LINEAR_CI_HEALER_EPIC` = `OPS-274`
- [ ] `CI_HEALER_DRY_RUN` = `false`
- [ ] `CI_HEALER_LIVE` = `false` during Phase 2; set to `true` when enabling Phase 3 live healer

## Branch protection (Settings → Branches)

- [ ] Allow GitHub Actions to push to `develop` and `main`, **or** configure `CI_HEALER_PAT` with bypass

## Linear

- [x] Epic created: [OPS-274](https://linear.app/opsai/issue/OPS-274/ci-healer-togglyfeaturemanagement)

## Rollout

- [ ] Phase 2: Disable `ci-healer.yml`, enable `ci-healer-phase2-flutter-dryrun.yml`, validate Linear comments
- [ ] Phase 3: Remove phase2 workflow, enable `ci-healer.yml` with all 16 analysis workflows
- [ ] Phase 4: Configure daily Cursor Automation per [README.md](./README.md)
