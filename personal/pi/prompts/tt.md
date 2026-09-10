---
description: Task tab — hand work to a fresh pi in a new herdr tab on this same checkout. A subagent writes the opening prompt so its text never enters this session. Spawns immediately, no confirmation.
argument-hint: "<what the new session should do>"
---
Spawn a fresh pi in a new herdr tab beside this one, at this same cwd, with an opening prompt written by the `tt-prompt-writer` subagent.

**Input**: `$@` — what the new session should do, in whatever shorthand the user typed.

**Related**: `/ts` routes one task to a subagent or a `team_spawn` teammate (mailbox-connected pane split, same tab). `/tq` orchestrates many. Use `herd implement` / `herd review` / `herd task` when the work needs its own branch and checkout.

### When this is the right tool

- The work belongs in this checkout but not in this session's context.
- The new session should run long and independently. You will not get its result back; there is no mailbox.
- No new branch is wanted. A branch means `herd implement`, not this.

If the task needs its own branch or a PR checkout, say so and stop — point at `herd implement <branch>` or `herd review <pr>`.

### Step 1: Guards

- Empty `$@` → ask what to hand off and stop.
- Not inside herdr (`test "${HERDR_ENV:-}" = 1` fails) → say so and stop.

### Step 2: Assemble the brief — this is your job

You do not write the prompt. You assemble the **context brief**: the short list of facts that live only in this conversation.

The spawned session does its own discovery on its first turn. It does not need a briefing — it needs an ask. Scan back for the few things it genuinely cannot find:

- Identifiers the user referred to obliquely — "that PR", "the doc I pasted", "the failing job".
- Prohibitions. What it must not touch, run, or publish.
- Constraints and corrections stated once in conversation and written down nowhere: a decision made, an approach ruled out, a redirect the session would otherwise walk into.
- Gotchas that cost real time: a slow command with a fast equivalent, a file whose obvious reading is wrong.

**Never put current state in the brief** — which branch is checked out where, which PR is open, what a file contains. It is one command away and it goes stale. A `/tt` audit handed a state list from memory found 6 of 9 entries wrong; the wrong ones cost more than omitting them all would have.

Also out: how to do the task, what you already did this turn, why the user asked, and anything readable from the repo the session starts in.

Over-supply rather than agonize — the writer applies its own admission test and drops what does not earn a line. Your job is to surface candidates, not to pre-trim them.

Then call the writer. Keep `CONTEXT` to bullet points — this is the one part that costs lead context, so it should be facts, not prose:

```
subagent({
  agent: "tt-prompt-writer",
  task: "RAW_INPUT:\n<verbatim $@>\n\nCWD:\n<absolute cwd>\n\nCONTEXT:\n- <fact>\n- <fact>"
})
```

It returns exactly three lines: `LABEL`, `PATH`, `GIST`. If it returns more, use the three fields and ignore the rest.

### Step 3: Spawn

Go straight from the writer's three lines to this command. Do not stop to confirm, do not print the label for approval, and do not read or quote the prompt file — keeping its text out of this session is the point, and the user reads it after the fact if they want to.

```bash
herd tab "<label>" "$(cat "<path>")"
```

Do not compose `herdr tab create` / `agent start` / `agent prompt` by hand — `herd` owns the ordering, the pane-id parsing, and the shell-ready retry, and hand-rolling it has failed before in exactly those places (see the `herd-spawn` skill).

`herd tab` uses the current `$PWD`, so `cd` first only if the new session belongs in a different directory than this one. Leave the prompt file on disk — it is the record of what the tab was told.

### Step 4: Report and stop

Print two lines:

> `<label>` spawned in tab `<n>`. Read it: `herdr agent read <label>` · drive it: `herdr agent prompt <label> "..."` · come back: `ctrl+alt+[`
> Prompt: `<path>`

Then stop. Do not start the work, read the files, or explore the code — that is the spawned session's job, and doing it here is the reason this command exists.

### Guardrails

- **No mailbox.** Unlike `team_spawn`, nothing reports back. Don't poll it, don't wait on it, don't plan around getting its output. Treat the tab as the user's.
- **Never inline the prompt.** Not in a message, not as a `herd tab` argument. It goes to a file and reaches `herd` through `$(cat …)`.
- **Focus moves.** `herd tab` ends focused on the new tab. `ctrl+alt+[` (or `prefix+p`) returns.
- **Spawn without asking.** No confirmation step. The one exception is a genuinely missing fact — if a path, PR number, or constraint the task hinges on is unclear, ask once before calling the writer rather than guessing into a prompt no one will read. Uncertainty about wording is not that.
