# devx pair-review Integration

`devx pair-review` is Shopify's AI PR review tool (Claude Opus 4.8). Running it
alongside the specialist agents gives the judge a **second independent source**.
In practice it catches things the agents miss (e.g. zone-specific frontend
anti-patterns, constant triplication) and convergence between the two sources
raises confidence in shared findings.

This is an **enhancement, not a hard dependency**. It only applies to PR reviews,
it is slow (minutes), and the review must degrade gracefully if it is
unavailable or fails.

## Eligibility

Run pair-review **only** when:

- `SOURCE_TYPE=pr` (there is a real GitHub PR number/URL), AND
- the user did not opt out (e.g. "skip pair-review", "agents only").

For `local_uncommitted` / `local_branch` there is no PR for the tool to fetch —
skip it silently and run the agents-only pipeline.

## Invocation

The tool zone is `//areas/tools/pair-review`, invoked as `devx pair-review`.
Headless JSON mode runs the analysis, prints one JSON document to stdout, and
exits — no browser, no server, no GitHub post:

```
devx pair-review --headless --json <PR-URL-or-number>
```

### Gotchas (learned the hard way)

- **It is slow.** Kick it off as a **background job** at the start of the
  reviewer-dispatch phase so it runs in parallel with the specialist agents.
  Collect it just before the judge.
- **Pass the full PR URL, not the bare number, and run from the worktree `src`
  root.** World uses Gitstream, so `origin` does not resolve to a github.com
  remote; bare-number invocation from a subdirectory fails git detection
  (exit 1, fast). The explicit URL from `$REVIEW_CWD` (the WTP `src` root)
  works reliably.
- The command name is `pair-review` (hyphen). `devx pair` resolves the wrong
  zone (`zone ID unavailable for //areas/tools/pair`).

### Kickoff (background)

```json
{
  "command": "cd <REVIEW_CWD> && devx pair-review --headless --json <PR_URL> > /tmp/pair-review-<N>.json 2>/tmp/pair-review-<N>.err; echo \"EXIT=$?\"",
  "cwd": "<REVIEW_CWD>"
}
```

Use `bg_run`. Note the returned job id.

## Collecting results

Just before dispatching the judge, `bg_wait` on the job (or `bg_log` to poll).
Then parse the JSON envelope.

### JSON envelope

```
{
  "ok": bool,
  "mode": str,
  "run": {
    "provider": str, "model": str, "tier": str,
    "head_sha": str, "summary": str, "status": str,
    "total_suggestions": int, "files_analyzed": int,
    "level_outcomes": { "level1":..., "level2":..., "level3":..., "consolidation":... }
  },
  "suggestions": [
    {
      "id": int, "severity": str|null, "ai_confidence": float, "ai_level": str,
      "type": str, "title": str, "body": str, "reasoning": str,
      "file": str, "line_start": int, "line_end": int, "is_file_level": bool
    }
  ],
  "count": int
}
```

- `severity` is one of `high` / `medium` / `minor` / `null`. A `null` severity
  with a praise-flavored `type`/`title` is a **positive observation**, not a
  finding — fold those into the report's positive highlights, do not send them
  to the judge as issues.
- `run.level_outcomes.consolidation == "failed"` means the tool's own
  dedup pass did not run, so `suggestions` will contain near-duplicates. That is
  fine — the judge deduplicates. Do not abort on a failed consolidation.

### Parse recipe

```python
import json
d = json.load(open("/tmp/pair-review-<N>.json"))
if not d.get("ok"):
    # tool errored — note it, continue agents-only
    ...
run = d["run"]
sugs = d["suggestions"]
findings = [s for s in sugs if (s.get("severity") or "").lower() in ("high", "medium", "minor")]
praise   = [s for s in sugs if s not in findings]
for s in sorted(findings, key=lambda s: (str(s.get("severity")), str(s.get("file")))):
    f = s.get("file") or ""  # optionally trim a known prefix (e.g. "areas/platforms/<zone>/") to shorten
    ls, le = s.get("line_start"), s.get("line_end")
    loc = f"{f}:{ls}" + (f"-{le}" if le and le != ls else "")
    print(f"[{s['id']}] {(s.get('severity') or 'none').upper()} | conf={s.get('ai_confidence')} | {s.get('type')}")
    print(f"    {s.get('title')}")
    print(f"    @ {loc}")
    # s['body'] holds the full rationale — pull it for actionable findings
```

## Feeding the judge

Merge pair-review findings **into the same judge task** as the agent findings,
tagged by source so the judge can weight convergence. Group findings into three
buckets:

- **CONVERGENT** — flagged by both the agents and pair-review. Note each side's
  severity so the judge can reconcile disagreements (e.g. security agent HIGH vs
  pair-review MEDIUM). Convergence raises confidence but the judge still verifies
  against code.
- **PAIR-REVIEW ONLY** — agents missed it; the judge verifies carefully since
  there is only one source.
- **AGENT ONLY** — pair-review missed it; unchanged from the normal flow.

Add this framing to the judge task preamble:

```
Findings come from TWO independent sources: (A) [N] specialized pi review agents,
and (B) Shopify's `devx pair-review` tool (<run.model>). Verify EVERY claim
against the real code, deduplicate, reconcile severity disagreements, reject
false positives. Note cross-source convergence (agents AND pair-review) vs
single-source — convergence raises confidence but you must still verify.
```

Keep the pair-review finding format compact (title + severity + conf + file:line
+ one-line body), same as the compressed agent findings — the judge reads the
source itself.

## Failure handling

Pair-review is best-effort. If the job:

- **exits non-zero** or `ok:false` → capture the `.err` file, note it in the
  Reviewers status line as `devx pair-review ❌ (<reason>)`, and run the judge
  with agent findings only.
- **is still running when the agents finish** → give it a short `bg_wait`
  (e.g. 120s). If it still has not finished, proceed agents-only and note the
  timeout. Do not block the whole review indefinitely.

Never fall back to reviewing the code yourself because pair-review failed — the
agent pipeline is the source of truth; pair-review only augments it.
