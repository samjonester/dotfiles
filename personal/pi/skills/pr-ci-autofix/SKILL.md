---
name: pr-ci-autofix
description: Watch CI for a PR (number or URL), notify on success, or triage/fix failures and confirm `git commit --amend` + `git push` before re-running the loop.
---

# PR CI Autofix

Use this skill when the user wants PR CI monitored continuously and wants automatic failure triage/fix support.

## Inputs

- PR number (for current repo), e.g. `492439`
- or PR URL, e.g. `https://github.com/org/repo/pull/12345`, `https://meteorite.shopify.io/repos/shop/world/pulls/2013456`

## Workflow

1. Resolve PR metadata from the provided number/link.
   - Resolve the PR system first per [../\_shared/pr-system.md](../_shared/pr-system.md) — GitHub and Meteorite PRs have separate number namespaces and different CLIs.
   - `PR_SYS=gh`: `gh pr view <pr> --json number,url,headRefName,statusCheckRollup`
   - `PR_SYS=gs`: `gs pr view <pr> --json | jq` for number/branch (no `--jq` flag; the browsable link is `htmlUrl`, never `url`). **There is no `statusCheckRollup` field** — get check state from `gs pr checks <pr> --json | jq` instead.
   - If PR resolution fails in both systems, ask the user for a Buildkite build URL.

2. Start CI monitoring loop (default every 2 minutes).
   - Preferred interactive form: `/loop 2m check PR <pr> CI status`
   - Tool form: `CronCreate` with recurring check prompt

3. On each check tick:
   - `PR_SYS=gh`: re-check PR status via `gh pr view` / `gh pr checks <pr>` and/or Buildkite tools
   - `PR_SYS=gs`: re-check via `gs pr checks <pr>`. **`gs pr checks` has no `--watch`** — the loop must poll on the interval and read the exit code (8 = pending). Never block on a watch flag that does not exist.
   - If CI is still pending/running: post short status and continue

4. Terminal outcomes:
   - **Success**: notify user CI passed and stop loop.
   - **Failure**:
     1. Get the Buildkite build URL from `gh pr checks <pr>`, or from `gs pr checks <pr> --json | jq` for `PR_SYS=gs`. There is no PR-URL-to-builds tool — pass the build URL to the `buildkite_*` tools as `build_url`.
     2. Identify root failing job(s): `buildkite_failed_jobs`
     3. Pull top failure log: `buildkite_job_failure` (capped tail, `log_lines` max 500 — raise it before assuming the error isn't there)
     4. Implement a targeted fix in code
     5. Run relevant tests/lint locally
     6. Notify user with root cause + fix summary

5. Before retrying CI, explicitly ask for confirmation:
   - "Would you like me to run `git commit --amend` and `git push` to retrigger CI?"
   - Only if user says yes: run `git add -A && git commit --amend --no-edit`, then `git push`, then `devx ci run` (CI no longer auto-triggers on push in shop/world)
   - Re-start monitoring loop for the updated PR/build

## Defaults

- Cadence: every 2 minutes
- Auto-stop: yes, when CI reaches terminal pass/fail and no retry was requested
- Failure summary: failing job URL + concise root cause + fix + local verification commands run

## Commands / Tools

- Monitoring loop: `/loop`, `CronCreate`, `CronList`, `CronDelete`
- PR resolution: `gh pr view` / `gs pr view` (via `bash`) — pick per resolved `PR_SYS`
- Check state: `gh pr checks <pr> --watch`, or polled `gs pr checks <pr>` (no `--watch`; exit 8 = pending)
- Buildkite triage: `buildkite_build_info`, `buildkite_failed_jobs`, `buildkite_job_failure`, `buildkite_artifacts`
- Git actions: `git commit --amend`, `git push`
- CI trigger: `devx ci run` (required after submit — CI no longer auto-runs on push in shop/world)

## Scheduler hygiene

- Always call `CronList` before `CronDelete` to pick the correct task ID.
- Remove stale watch loops after terminal completion.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "This test failure is unrelated to the PR, I'll skip it" | Verify first. Check if the test file overlaps with changed files. If genuinely unrelated (infra flake, base-branch break), note it explicitly in the commit message and let the user decide. |
| "I'll fix this unrelated failure while I'm here" | Scope creep. The PR's commit should only contain fixes for failures caused by the PR's changes. Unrelated fixes go in separate branches. |
| "A git command failed during the fix, I'll try another approach" | Stop. Diagnose. Ask. Git failures during CI-fix loops often signal rebase conflicts or state drift that alternative commands make worse. |
| "CI is red but I think the fix is right, I'll push again" | Never push a fix without running the verification command locally first. Verify, then push. Blind retries waste CI minutes. |
