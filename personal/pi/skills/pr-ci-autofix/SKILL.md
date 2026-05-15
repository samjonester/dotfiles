---
name: pr-ci-autofix
description: Watch CI for a PR (number or URL), notify on success, or triage/fix failures and confirm `gt modify` + `gt submit` before re-running the loop.
---

# PR CI Autofix

Use this skill when the user wants PR CI monitored continuously and wants automatic failure triage/fix support.

## Inputs

- PR number (for current repo), e.g. `492439`
- or PR URL, e.g. `https://github.com/org/repo/pull/12345`

## Workflow

1. Resolve PR metadata from the provided number/link.
   - Preferred: `gh pr view <pr> --json number,url,headRefName,statusCheckRollup`
   - If PR resolution fails, ask the user for a Buildkite build URL.

2. Start CI monitoring loop (default every 2 minutes).
   - Preferred interactive form: `/loop 2m check PR <pr> CI status`
   - Tool form: `CronCreate` with recurring check prompt

3. On each check tick:
   - Re-check PR status via `gh pr view` and/or Buildkite tools
   - If CI is still pending/running: post short status and continue

4. Terminal outcomes:
   - **Success**: notify user CI passed and stop loop.
   - **Failure**:
     1. Identify root failing job(s): `bk_failed_jobs`
     2. Pull top failure log: `bk_job_failure`
     3. Implement a targeted fix in code
     4. Run relevant tests/lint locally
     5. Notify user with root cause + fix summary

5. Before retrying CI, explicitly ask for confirmation:
   - "Would you like me to run `gt modify` and `gt submit` to retrigger CI?"
   - Only if user says yes: run `gt modify`, then `gt submit`, then `devx ci run` (CI no longer auto-triggers on push in shop/world)
   - Re-start monitoring loop for the updated PR/build

## Defaults

- Cadence: every 2 minutes
- Auto-stop: yes, when CI reaches terminal pass/fail and no retry was requested
- Failure summary: failing job URL + concise root cause + fix + local verification commands run

## Commands / Tools

- Monitoring loop: `/loop`, `CronCreate`, `CronList`, `CronDelete`
- PR resolution: `gh pr view` (via `bash`)
- Buildkite triage: `bk_build_info`, `bk_failed_jobs`, `bk_job_failure`
- Git/stack actions: `gt modify`, `gt submit` (never `git commit`)
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
