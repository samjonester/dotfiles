---
name: pr-follow-up
description: Check the status of open PRs where you requested changes — classify each as stale, updated, or addressed, and suggest next actions (re-review, nudge the author). Triggers on 'follow up on my PRs', 'check review status', 'did they address my feedback', 'outstanding reviews', 'stale PRs', or carried-forward PR follow-up TODOs in daily context.
---

# PR Follow-up Tracker

Check whether reviewees have addressed your requested changes on open PRs.

## Trigger

Use this skill when the user asks:

- "follow up on my PRs", "check review status", "did they address my feedback"
- "outstanding reviews", "stale PRs", "what's pending"
- Or when daily context shows carried-forward PR follow-ups

## Workflow

### Step 1: Gather PR list

Source PRs from one of:

1. **User provides PR numbers/URLs** directly
2. **Daily context** — scan `In Progress` and `Carried Forward` sections for PR references with `CHANGES_REQUESTED` or review follow-up TODOs
3. **Query both PR systems** — see [../\_shared/pr-system.md](../_shared/pr-system.md). GitHub and Meteorite PRs have separate number namespaces and different CLIs, and **neither query returns the other system's PRs**. Run both and merge the results, deduplicating by system + number (never by number alone — the same number exists in both):

   ```bash
   # GitHub — all repos, filters server-side on review state
   gh search prs --reviewed-by=@me --state=open --review=changes_requested --json number,title,repository,updatedAt --limit 20

   # Meteorite — shop/world only; `gs` has no `--jq`, pipe through jq
   gs pr list --review-requested @me --json | jq
   ```

   There is **no `gs` equivalent of `gh search prs`** — `gs pr list` is scoped to `shop/world` and has no `--review=changes_requested` filter (its other selectors are `--author @me`, `--everyone`, `--head <branch>`). Filter the Meteorite side client-side: for each candidate, pull the review state from `gs pr view <number> --json | jq` and keep only the PRs where you requested changes.

### Step 2: Check each PR

For each PR, gather review timeline + latest commits with that PR's CLI:

```bash
# PR_SYS=gh
gh pr view {number} --repo {owner}/{repo} --json title,state,reviews,commits,reviewRequests,url

# PR_SYS=gs — `--json` takes no field list and there is no `--jq`; pipe through jq
gs pr view {number} --json | jq
```

Classify each PR into one of:

- **🔴 Stale** — No new commits since your review. Reviewee hasn't started addressing feedback.
- **🟡 Updated** — New commits exist after your review, but your review threads are not all resolved. May need re-review.
- **🟢 Addressed** — New commits exist AND all your review threads are resolved. Ready for re-review.
- **⚪ Merged/Closed** — No action needed.

For a Meteorite PR, thread state comes from `gs pr view {number} --comments` (which prints a `thread: <uuid>` per thread) — there is no GraphQL `reviewThreads` query. If that output does not mark resolution state, classify on commit activity alone and say so in the report rather than asserting a thread count.

### Step 3: Report

Produce a compact status table:

```
PR Follow-up Status (as of {date})

🔴 Stale (no activity since your review):
  - #{number} {title} — reviewed {N} days ago, 0 new commits
    {pr_link}

🟡 Updated (needs re-review):
  - #{number} {title} — {N} new commits, {M}/{total} threads resolved
    {pr_link}

🟢 Addressed (ready for re-review):
  - #{number} {title} — all threads resolved, {N} new commits
    {pr_link}
```

### Step 4: Suggest actions

For stale PRs (>3 days), suggest pinging the author. Draft a brief, friendly Slack message if the user wants to nudge.

For addressed PRs, suggest which to re-review first (by age, size, or priority).

## Notes

- Links: `https://github.com/<org>/<repo>/pull/<N>` for GitHub PRs; for Meteorite PRs use `htmlUrl` from `gs pr view <number> --json` (`https://meteorite.shopify.io/repos/shop/world/pulls/<N>`) — never the `url` field, which is the unopenable `api.gitstream.shopify.io` host
- Check daily context first — the user often carries forward specific PR follow-ups with notes about what to look for
- Don't include PRs where the user was not the reviewer who requested changes
