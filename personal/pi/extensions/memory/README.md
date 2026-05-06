---
summary: Persistent memory bank with full-text search — active projects, daily context, and auto-discovered knowledge.
commands: [/memory]
tools: [memory_read, memory_update, memory_append, memory_search, memory_list]
category: productivity
keywords: [memory, context, projects, knowledge, persistence, search]
---

# Memory — Persistent Memory Bank

Gives pi a personal memory bank that persists across sessions. Inspired by [shopify-playground/brain](https://github.com/shopify-playground/brain)'s memory system, stripped down to the essentials.

## What it does

**On every session start:**
- Archives yesterday's `dailyContext.md` to `history/daily/YYYY-MM/` when the date rolls over
- Carries forward "Context for Tomorrow" into the new day
- Builds a full-text search index over all memory bank files
- Scaffolds default memory bank files on first run

**On every prompt:**
- Injects `activeProjects.md` and `dailyContext.md` into context
- Searches for relevant knowledge and history files based on the prompt content (BM25 + fuzzy matching via [MiniSearch](https://github.com/lucaong/minisearch))

**Tools for the agent:**
- `memory_read` — read any memory bank file
- `memory_update` — write a full memory bank file
- `memory_append` — safely append entries to a section (won't clobber existing content)
- `memory_search` — fuzzy full-text search across all memory files (knowledge, history, core)
- `memory_list` — list files in the memory bank

**Command:**
- `/memory` — show memory bank status (file sizes, knowledge count, archive count, search index stats)

## Memory bank location

```
~/.pi/memory/
├── core/
│   ├── activeProjects.md    # Active work and priorities (max 50 lines)
│   └── dailyContext.md      # Today's work, decisions, carry-forward (max 150 lines)
├── knowledge/
│   ├── index.csv            # Legacy trigger word index (optional, search replaces this)
│   └── *.md                 # Reference docs — auto-discovered via search
└── history/
    └── daily/
        └── YYYY-MM/
            └── YYYY-MM-DD-dailyContext.md   # Archived daily contexts
```

Override the location with `PI_MEMORY_DIR` env var.

## How knowledge discovery works

All `.md` files in the memory bank are indexed with [MiniSearch](https://github.com/lucaong/minisearch) — a lightweight full-text search engine with BM25 ranking, fuzzy matching, and prefix search. No external services, no model downloads, no configuration needed.

When you send a prompt, the extension automatically searches the index for relevant knowledge and history files:

- **Knowledge files** are always included when they match
- **History files** are included when they score strongly relative to the top result
- **Core files** (activeProjects, dailyContext) are always injected directly, never via search

The search index is rebuilt on session start and updated incrementally when `memory_update` or `memory_append` write files.

### Optional: Semantic search with qmd

If you have [qmd](https://github.com/tobi/qmd) installed, the memory extension will automatically use it for **semantic search** — combining BM25 keyword matching with vector embeddings and LLM re-ranking. This dramatically improves recall for natural-language queries like *"what did I decide about the webhook naming convention?"* even when the actual text uses different words.

**Quick setup:**
```
# Install qmd
npm install -g @tobilu/qmd

# Set up the memory bank as a qmd collection (from within pi)
/memory setup-qmd
```

Or manually:
```bash
qmd collection add ~/.pi/memory --name pi-memory --mask "**/*.md"
qmd context add qmd://pi-memory "Pi agent memory bank — projects, daily context, knowledge, and session history"
qmd embed
```

When qmd is available, it's used for:
- `memory_search` tool → `qmd query` (hybrid BM25 + vector + re-ranking)
- Auto-injected context on each prompt → `qmd query --full`
- Falls back to MiniSearch if qmd returns no results or isn't available

Run `/memory` to see which search backend is active.

> **Note:** qmd requires ~2GB of model downloads on first use (embedding, re-ranking, and query expansion models). These are cached locally. The extension works fine without qmd — MiniSearch is always available as a fallback.

### Legacy trigger words

The old `knowledge/index.csv` trigger-word system still works but is no longer needed. Search-based discovery finds knowledge files automatically without manual trigger word maintenance. You can safely delete `index.csv` entries as you add new knowledge files.

## Agent guidelines

The extension injects prompt guidelines that shape how the agent maintains memory. These are inspired by [shopify-playground/brain](https://github.com/shopify-playground/brain)'s documentation principles.

### Proactive knowledge capture

> When the user establishes conventions, tone/voice rules, architectural decisions, workflow preferences, or any reusable guidance — immediately store it as a knowledge file. Don't wait to be asked.

### Knowledge file discipline

- **Target 10-50 lines**, max 100 lines per file. Split large files into focused topics.
- **Include source attribution**: who said it, when, and where (PR, Slack thread, meeting).
- **Skills vs knowledge**: if a pattern is a multi-step workflow (3+ repeating steps), it belongs as a Skill, not a knowledge file.

### Word budgets

dailyContext entries must be concise to keep the file scannable and under 150 lines:
- **Completed items**: 15-25 words (action taken, not full analysis)
- **Key Decisions**: 10-20 words (outcome + rationale)
- **activeProjects**: one line per project, no sub-bullets

### No redundancy between sections

Each fact belongs in exactly one dailyContext section:
- **Completed** = actions taken (what you did)
- **Key Decisions** = outcomes decided (what was resolved)
- **In Progress** = things you'll pick up again this session
- **Context for Tomorrow** = actionable next steps for future sessions

A meeting that produced a decision: Completed says "Held meeting with X", Key Decisions captures the outcome. No overlap.

### Self-verification

Before modifying code, committing, or taking irreversible actions, the agent is instructed to check for relevant knowledge files (git conventions, component patterns, API design rules, testing standards) using `memory_search`.

## Example workflows

### Daily workflow
```
You: Good morning, what was I working on?
→ Agent reads dailyContext.md and activeProjects.md from memory, tells you

You: I finished the auth refactor
→ Agent appends to Completed, updates activeProjects.md

You: Let's wrap up for the day
→ Agent updates "Context for Tomorrow" with carry-forward items
```

### Knowledge capture
```
You: For all proposals in this project, use a confident and direct tone.
     No hedging words like "maybe" or "perhaps". Be specific and assertive.
→ Agent immediately saves this as knowledge/proposal-tone.md
→ Future sessions find it automatically when you mention proposals
```

### History search
```
You: What did I decide about the webhook naming convention?
→ Agent uses memory_search to find the historical dailyContext where the decision was recorded
```

## Setup

Nothing to configure — memory bank is scaffolded automatically on first run at `~/.pi/memory/`. Start using it by telling pi about your projects and it will maintain the memory bank across sessions.
