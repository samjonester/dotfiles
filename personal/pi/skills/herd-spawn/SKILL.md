---
name: herd-spawn
description: Hand work off to a pi agent running in its own worktree, by shelling out to `herd`. Use when the user asks for "a worktree running pi", or to spawn / kick off / hand off / spin up an agent — "give me a worktree to research X", "open a worktree and review PR N", "start a branch for Y and have an agent build it", "put this in its own worktree". Also covers `herd commander`, the long-lived root workspace these launch from. Never compose herdr workspace/tab/agent calls by hand for this.
---

# Spawn agent work into a worktree

`herd` (`~/dotfiles/bin/herd`) owns the whole sequence: claim the checkout, create a labeled workspace, start pi, deliver the opening prompt. Your job is to translate a conversational ask into one `herd` invocation, then get out of the way.

## Never hand-roll the sequence

Composing this from `herdr` primitives has failed before, in these exact ways:

| Hand-rolled | What `herd` does | Failure |
|---|---|---|
| `$(_wtp "$B" 2>&1)` | no `2>&1` | stderr folds into the captured path |
| `herdr tab create` | `herdr workspace create --label "$verb/$branch"` | tab inside the caller, not its own workspace |
| guessed `--pane wX:pN` | parses `.result.root_pane.pane_id` | agent starts against nothing |
| no `pane wait-output` | waits for the shell prompt | types before the shell is ready |
| no `agent prompt` | `hd agent prompt` | **agent starts with no task** |

The `herdr` skill is for reading and driving panes that already exist — use it to check on a spawned agent, never to create one.

## Pick the verb

| The ask | Command |
|---|---|
| New work, no branch yet | `herd implement <new-branch> "<prompt>"` |
| Review a PR or existing branch | `herd review <pr-number\|branch>` |
| Anything else on an existing branch — fix CI, address feedback, bisect | `herd task <pr-number\|branch> "<prompt>"` |
| Work that belongs in the current checkout, not its own branch | `herd tab <label> "<prompt>"` |
| Return to the originating workspace | `herd commander` |

`herd tab` is the one verb that claims no slot and creates no worktree: a tab beside the caller, same `$PWD`, fresh pi. Reach for it when the ask has no branch in it — research, a long triage, a second opinion on the tree as it stands. Everything below about writing the prompt applies to it unchanged, though the `/tt` prompt template hands that writing to the `tt-prompt-writer` subagent.

`review` and `task` accept a bare PR number and resolve it themselves (`gs` for shop/world, `gh` elsewhere). Pass the number, not a branch you looked up.

For `implement`, derive the branch as `sam/<kebab-summary>` — e.g. `sam/dv360-cm360-research`. shop/world branches are always created off `origin/main`; `_wtp` has no `--base`, so you cannot stack from here.

## Write the prompt — this is the actual work

The spawned agent gets **one string and no conversation history**. It cannot see this session, the files you read, or the links the user pasted. A prompt that reads fine here is often unusable there.

Include, always:

- What to produce, stated first.
- Every URL, doc link, PR number, file path, and identifier — in full. Never "the proposal" or "that PR".
- The constraints that came up in conversation but exist nowhere on disk.
- Where the answer goes: a reply, a file, a PR, a draft.

Leave out: what you already did, why the user asked, anything it can read from the repo it is sitting in.

## Confirm, then run

Show the user the verb, the branch, and the full prompt text. Wait for go-ahead — a bad branch name burns a pool slot, and there are only ~12.

Then invoke with **both arguments always present**. `herd` prompts interactively for a missing one and dies without a TTY:

```
herd: PR number or branch:  (no TTY — pass it as an argument instead)
```

`cd` to the repo the work belongs to first, since `herd` routes on cwd — shop/world → WTP pool slot, anything else → `herdr worktree create`:

```bash
cd ~/world/trees/root/src/areas/platforms/mozart && \
  herd task 2039282 "Fix the failing CI on this branch. Start with `gs pr checks 2039282`..."
```

## Then stop

`herd` ends by focusing the new workspace, so the user's view moves. Report the branch, the slot, and the workspace label — then stop. Do not start the research, read the proposal, or explore the code. That work belongs to the agent you just spawned; doing it here is the failure this skill exists to prevent.

If the user wants to stay put, tell them `herd commander` brings them back.
