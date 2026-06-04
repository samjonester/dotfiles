---
name: atc-tracker
description: "Track and triage ATC (Administrator on Call) tasks for the Marketing Efficiency team. Manages open/resolved task log at ~/.pi/tmp/atc-tasks.md. Triggers on: 'triage ATC', 'open ATC tasks', 'ATC status', 'resolve ATC task', 'close ATC task', 'new ATC task', 'what ATC items are open', 'ATC triage', or any request involving ATC duty task tracking and triage."
---

# ATC Task Tracker

You manage ATC (Administrator on Call) tasks for the Marketing Efficiency team. Tasks are tracked in `~/.pi/tmp/atc-tasks.md`.

## Task File Location

`~/.pi/tmp/atc-tasks.md`

If the file doesn't exist, create it with this header:

```markdown
# ATC Tasks

<!-- Reverse chronological by day opened. Open tasks first, then resolved. -->
```

## Operations

### 1. Triage ATC (scan for new work)

When the user asks to triage, scan these sources **in parallel**:

**Slack channels:**
- `#help-mozart` — search for recent messages about LPG (landing page generator) and paid ads issues
- `#marketing-efficiency` — search for LPG and paid ads issues
- Channels in the user's Slack "Monitor" section — check for anomalies, alerts, or unusual activity

Use `slack_search` with queries like:
```
in:#help-mozart after:today LPG OR "landing page" OR "paid ads" OR error OR help
in:#marketing-efficiency after:today LPG OR "landing page" OR "paid ads" OR error OR help
```

For Monitor channels, use the slack-triage skill's channel-sections approach:
```bash
slack-mcp get-channel-sections
```
Then scan channels in the "Monitor" section for recent anomalies.

**GitHub issues:**
```bash
gh search issues 'label:maintenance,Security,action-item,enhancement,bug,atc,error-severity:P2,lpg-followup repo:shop/issues-marketing-efficiency -label:#gsd:48585,#gsd:48586,#gsd:49319,#gsd:49475,#gsd:50400 status:"On Deck","In Progress","Awaiting Review"' --json number,title,url,labels,updatedAt,state --limit 25
```

**Present findings** as a numbered list grouped by source. For each potential task, show:
- Source (Slack channel/thread or GitHub issue)
- Brief summary
- Severity/urgency assessment

Ask the user which items to track as new ATC tasks.

### 2. Check Open ATC Tasks

When the user asks "what ATC tasks are open", "open ATC tasks", "ATC status", etc.:
- Read `~/.pi/tmp/atc-tasks.md`
- Show ONLY the open tasks from the file — do NOT re-scan Slack or GitHub
- Group by day, most recent first

### 3. Add New ATC Task

When the user identifies a new task (from triage or ad-hoc):

Add an entry under today's date section in the task file. If today's section doesn't exist, create it at the TOP of the file (after the header).

**Format:**
```markdown
## 2026-05-18

### Open

- **ATC-YYYYMMDD-HHMMSS | Brief title** — Short description of the issue
  - Source: [slack thread](https://shopify.slack.com/archives/CHANNEL/pTIMESTAMP) or [issue #N](url)
  - Priority: P1/P2/P3
  - Notes: any context
```

Task ID is `ATC-YYYYMMDD-HHMMSS` (seconds precision) where the timestamp is 24h format in the user's local timezone. When creating multiple tasks at once, increment the seconds to ensure uniqueness. Always include a clickable link to the source Slack message/thread or GitHub issue.

### 4. Resolve ATC Task

When the user says they resolved a task:

1. Move the task from `### Open` to `### Resolved` under the same day section
2. Add resolution metadata:

```markdown
### Resolved

- **ATC-YYYYMMDD-HHMMSS | Brief title** — Short description
  - Source: [slack thread](url)
  - Resolved: 2026-05-18 14:30 | Session: <current pi session ID>
  - Resolution: Brief description of what was done
```

3. Get the current pi session ID from the environment or context
4. Cross-reference with daily memory — append to dailyContext.md Completed section:
   `- [ATC] Resolved: <task title> — <resolution summary>`

### 5. Task File Structure Rules

- Days are in **reverse chronological order** (newest day at top, after header)
- Within each day, tasks are ordered by time opened (newest first)
- Each day section has `### Open` and `### Resolved` subsections
- Only create subsections that have tasks (skip empty `### Resolved` if none that day)
- When all tasks for a day are resolved, keep the day section for the record

## Wiki Knowledge

Before troubleshooting any ATC issue, read the ATC knowledge wiki page for relevant links and runbooks:

```
wiki_read path: "methods/atc-triage.md"
```

This contains links to Mozart docs, Brochure docs, Vault resources, and common troubleshooting paths.

## Cross-referencing

When resolving tasks, always:
1. Update the task file
2. Append to `dailyContext.md` Completed section
3. If the resolution involved a significant decision, append to Key Decisions section too
