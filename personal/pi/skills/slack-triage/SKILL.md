---
name: slack-triage
description: "Triage Slack unreads with context-aware prioritization. Modes: morning (build todo list), mid-day (immediate attention), end-of-day (loose ends), catch-up from date (after OOO). Auto-detects ATC duty, uses VIP list, correlates cross-channel signals, classifies thread resolution, and curates Interesting highlights. Triggers on: 'triage slack', 'morning triage', 'mid-day triage', 'eod triage', 'what's new on slack', 'slack catch-up from [date]', or any request to review Slack unreads."
---

# Slack Triage

You triage Slack unreads with context-aware prioritization. You use `slack-mcp` CLI commands via bash.

## Step 0: Detect Mode

Parse the user's request to determine triage mode:

| Mode           | Triggers                               | Behavior                                                 |
| -------------- | -------------------------------------- | -------------------------------------------------------- |
| **Morning**    | "triage slack", "morning triage"       | All current unreads. Build a todo-list.                  |
| **Mid-day**    | "mid-day triage", "what's new"         | Focus on things needing immediate attention.             |
| **End-of-day** | "eod triage", "loose ends"             | Open threads + unanswered mentions. Identify loose ends. |
| **Catch-up**   | "triage from [date]", "slack catch-up" | All unreads from specified date forward.                 |

If ambiguous, ask. Default to Morning.

## Step 1: Gather Data

Run these in parallel:

```bash
slack-mcp get-unreads --json
slack-mcp get-channel-sections
slack-mcp test
```

From `get-unreads` JSON, extract:

- `thread_list` — threads with unread replies (note: these include threads you're participating in)
- `channels` — unread channels with `oldest` timestamp (unread anchor)
- `ims` — DMs
- `mpims` — group DMs
- **VIP conversations**: any entry (ims, mpims, channels) where `vip_count > 0`
- **Mention conversations**: any entry where `mention_count > 0`

From `get-channel-sections`, build the section → channel mapping.

## Step 2: Detect ATC Status

Search the most recent messages in Monitor section channels for the spy bot ATC announcement:

```bash
slack-mcp get-messages channel --channel <monitor-channel-id> --oldest <recent-timestamp>
```

Look for messages matching: "Your Marketing Efficiency ATC is @Sam Jones" (user handle `S09A99TRQUW`).

**Confirm with the user:** "Detected you're on ATC this week. Elevating Monitor channels to P0. Correct?"

Wait for confirmation before proceeding.

## Step 3: Classify Channels into Priority Groups

Map every unread channel/DM/thread into one of three groups:

### Group 1: P0–P1 — Process in this order

1. **Monitor channels** (only when ATC confirmed)
2. **Threads with unread mentions** (`mention_count > 0` in thread_list)
3. **Threads with unreads** (remaining items in thread_list)
4. **VIP unreads** (any conversation with `vip_count > 0`)

DMs and channels are treated identically within this group.

### Group 2: P1–P3 — No particular order

- Channels in **Team** sidebar section (+ DMs listed there)
- Channels in **Projects** sidebar section
- Other DMs not in Group 1
- **Monitor** channels (when NOT on ATC)

### Group 3: P2–P4 — No particular order

- Channels in **Interesting** sidebar section (special treatment — see Step 6)
- Channels in **Starred**, **Auxiliary Feeds**, **Channels** (default), **External connections**, **Bursts/Summit** sections

## Step 4: Process Group 1 (P0–P1)

For each item in Group 1, in order:

### Monitor channels (when ATC)

For each Monitor channel with unreads:

```bash
slack-mcp get-messages channel --channel <ID> --oldest <oldest_unread_ts>
```

**Do NOT limit message count.** Get everything from the unread point.

For every message that has thread replies, pull the thread:

```bash
slack-mcp get-messages thread --channel <ID> --ts <message_ts>
```

For each thread, provide:

- A summary of the conversation
- Resolution status:
  - ✅ **Resolved** — human confirmed fix/answer
  - 🔶 **In Progress** — human engaged but not yet resolved
  - 🔴 **Unanswered** — no human response, or only Verdant Express bot responded, or stale >24h

**Important:** Verdant Express bot responses alone do NOT count as resolved. Only human engagement counts.

**Ops/alert channels:** If a channel is primarily Observe alerts or bot notifications, collapse to net state:

- Currently firing alerts (unresolved)
- Notable patterns (same alert firing/recovering = flaky)
- Deploy status (succeeded/failed)

### Threads with unread mentions & unreads

For each thread in `thread_list`:

```bash
slack-mcp get-messages thread --channel <channel_id> --ts <thread_ts>
```

Summarize conversation and classify resolution status.

### VIP unreads

For conversations with `vip_count > 0`, fetch messages from unread point and summarize with full depth.

### Cross-channel correlation

After processing all Group 1 items, check for correlated signals:

- Same entity referenced across channels (e.g., same URL, same ID like "webinar #2258")
- Temporal proximity (events within ~30 min)
- Same domain/system (e.g., multiple Brochure LP failures)

Group correlated signals and present together.

## Step 5: Process Group 2 (P1–P3)

For each channel/DM with unreads:

```bash
slack-mcp get-messages channel --channel <ID> --oldest <oldest_unread_ts>
```

Provide message-level summaries. For messages that have thread replies, pull and summarize threads. Note unresolved items.

Less depth than Group 1 — focus on what's notable, what needs attention, what's FYI.

## Step 6: Process Group 3 (P2–P4)

### Interesting channels — Hybrid curation

Read all messages. Surface items matching the user's interest profile:

- AI tooling, coding agents, dev workflows, agent-human interaction patterns
- External articles, blog posts, repos, demos worth understanding or adopting
- Tools or techniques that could improve personal workflow
- Pi internals, extensions, performance insights
- Notable open-source developments

When a message has a long thread (many replies), flag as "🔥 active discussion."

**Skip:** Routine discussion, food photos, wrong-channel posts, generic testimonials, low-signal debates.

### All other Group 3 channels

One-line summaries only. Surface only: significant announcements, things that directly affect the user, or items with unusually high engagement. Most Group 3 channels will be "N unreads, nothing notable."

## Step 7: PR Review Queue

Always include, regardless of ATC status.

Find PRs from:

1. Graphite bot DM (check DMs for messages from "Graphite" containing review requests)
2. PRs mentioned in channel messages during triage

For each PR, check status:

```bash
gh pr view <number> --repo shop/world --json state,reviews,title,additions,deletions,url,mergedAt,reviewDecision
```

Classify:

- **Merged** — TLDR (user may want to catch up on the change)
- **Approved** — note who approved, TLDR
- **Has reviews, no approval** — user may want to weigh in
- **No reviews** — user may want to review

Note bump count (if PR was posted multiple times in channels) and age.

## Step 8: Present Results

### Per-group summaries

Present each group's findings with the structure used during processing.

### Deferral suggestions

If any items need deep work in a separate session, present as suggestions:

> **Suggested deferrals:**
>
> - T3: Ads reporting quicksite — needs dedicated session to debug queries
> - T5: Breanna's data model questions — requires Mozart schema investigation

Wait for user approval before writing to dailyContext via `memory_append`.

### Action table

End with a priority-ordered table using short identifiers:

| ID  | Priority | Item                         | Channel                    | Action                                |
| --- | -------- | ---------------------------- | -------------------------- | ------------------------------------- |
| T1  | P0       | Webinar #2258 stuck          | #help-mozart               | Investigate Brochure LP failure       |
| T2  | P0       | Amanda experiment request    | #help-mozart               | Route to journey experimentation team |
| T3  | P1       | Reply to Breanna's questions | DM                         | Answer 4 data model questions         |
| T4  | P2       | Tim's 5 cleanup PRs          | #marketing-efficiency-team | Review or delegate                    |

The user can reference these: "let's work on T1", "defer T3 and T4", "mark T2 done".

## Key Slack MCP Commands Reference

```bash
slack-mcp get-unreads --json              # Starting point — all unreads with vip_count
slack-mcp get-channel-sections            # Sidebar groups for priority mapping
slack-mcp get-messages channel --channel <ID>                    # Channel messages
slack-mcp get-messages channel --channel <ID> --oldest <ts>      # From unread point
slack-mcp get-messages thread --channel <ID> --ts <ts>           # Thread replies
slack-mcp get-messages search --query "..."                      # Search
slack-mcp get-channel-info --channel-id <ID>                     # Channel metadata
slack-mcp test                                                    # Verify auth
```

**Critical rules:**

- Never limit message count on Group 1 channels — get everything from unread point
- `get-reactions` CLI has broken array args — don't use for batch queries
- Verdant Express bot ≠ human response — always check for actual human engagement in threads
- Use `--oldest` parameter with the unread anchor timestamp from `get-unreads` to start at the right point
