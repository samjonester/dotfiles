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
3. **GitHub query** — find PRs where user has submitted reviews with requested changes:
   ```bash
   gh search prs --reviewed-by=@me --state=open --review=changes_requested --json number,title,repository,updatedAt --limit 20
   ```

### Step 2: Check each PR

For each PR, gather:

```bash
# Get review timeline + latest commits
gh pr view {number} --repo {owner}/{repo} --json title,state,reviews,commits,reviewRequests,url
```

Classify each PR into one of:

- **🔴 Stale** — No new commits since your review. Reviewee hasn't started addressing feedback.
- **🟡 Updated** — New commits exist after your review, but your review threads are not all resolved. May need re-review.
- **🟢 Addressed** — New commits exist AND all your review threads are resolved. Ready for re-review.
- **⚪ Merged/Closed** — No action needed.

### Step 3: Report

Produce a compact status table:

```
PR Follow-up Status (as of {date})

🔴 Stale (no activity since your review):
  - #{number} {title} — reviewed {N} days ago, 0 new commits
    {graphite_or_github_link}

🟡 Updated (needs re-review):
  - #{number} {title} — {N} new commits, {M}/{total} threads resolved
    {graphite_or_github_link}

🟢 Addressed (ready for re-review):
  - #{number} {title} — all threads resolved, {N} new commits
    {graphite_or_github_link}
```

### Step 4: Suggest actions

For stale PRs (>3 days), suggest pinging the author. Draft a brief, friendly Slack message if the user wants to nudge.

For addressed PRs, suggest which to re-review first (by age, size, or priority).

## Notes

- Use Graphite links for `shop/world` PRs, GitHub links for other repos
- Check daily context first — the user often carries forward specific PR follow-ups with notes about what to look for
- Don't include PRs where the user was not the reviewer who requested changes
