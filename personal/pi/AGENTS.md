# Personal Coding Preferences

## Tool Usage

- Never use `sed -n` to read file ranges — use the `read` tool with offset/limit parameters instead
- Never use `cat`, `head`, or `tail` to read files — use the `read` tool
- Never use `sed -i` for file edits — use the `edit` tool for surgical changes or `write` for full rewrites
- Prefer the native `grep`, `find`, and `ls` tools over their bash equivalents — they are faster, produce fewer tokens, respect .gitignore, and don't trigger bash-guard security reviews
- When exploring code, batch related reads into a single request when the files are independent

## Model & Thinking Selection

The goal is **speed and responsiveness** — use the fastest model that produces correct results for the task at hand.

### Opus (claude-opus-4-6) — deep reasoning, code correctness
- **Code editing** (write, edit, refactor, implement features, fix bugs): always use Opus with high thinking
- **Code reviews and architectural planning**: use Opus with high thinking
- **Debugging subtle issues**: use Opus with high thinking
- **Simple substitutions and small edits** (renaming a variable, fixing a typo): Opus is fine since it's already loaded, but drop to medium thinking — high thinking adds latency with no quality gain

### Sonnet (claude-sonnet-4-6) — fast, correct for straightforward work
- **Mechanical tasks** (grep, find, read, file exploration, running tests, git operations, renaming across files): use Sonnet with medium thinking — significantly faster than Opus for these and produces identical results
- When entering a long stretch of mechanical work (>10 sequential tool calls of grep/read/find/test runs), suggest switching to Sonnet for speed
- After the mechanical stretch, suggest switching back to Opus before code editing resumes

### Haiku (claude-haiku-4-5) — near-instant responses for trivial tasks
- **Quick lookups and summaries**: reading a file and answering a factual question about it, summarizing grep results, listing what changed in a diff
- **Bulk simple operations**: when doing 20+ repetitive tool calls that need no reasoning (e.g., checking file existence, reading configs, collecting data across many files before doing real work)
- **Drafting commit messages**: generating conventional commit messages from staged changes
- Do NOT use Haiku for code editing, reviews, PR descriptions, or anything requiring correctness judgment

### Codex (gpt-5.3-codex) — break out of loops, get a fresh perspective
- **If the same approach has failed twice, switch to Codex automatically.** Don't ask — just switch, explain why ("Switching to Codex for a fresh approach — same fix has failed twice"), try the problem from scratch, and switch back to Opus when resolved.
- **Second opinion on tricky bugs**: when debugging is going in circles, Codex often spots what Claude misses (and vice versa)
- **Polyglot strength**: Codex can be stronger on less common languages or frameworks where Claude may have less training data
- **Large-scale code generation**: Codex has a 400K context window — useful when you need to ingest a huge codebase before generating code

### General rules
- Default to Opus with high thinking — it's the primary model
- Switch to Sonnet for speed during mechanical phases, switch back before editing
- Consider Haiku when you're about to do a long stretch of trivial reads/lookups before the real work begins
- Consider Codex when stuck or when working outside the Ruby/TypeScript comfort zone

### Multi-model planning workflow
When asked to "plan", "propose options", "evaluate approaches", or similar planning tasks, use this workflow:

#### Step 0: Question (fast pre-pass)
Run `plan-questioner` (Sonnet) to sharpen the problem statement before any solution work begins. It reads the relevant code, identifies ambiguities, discovers hard constraints, and produces a refined problem statement. This avoids wasting two expensive planning calls on an under-specified problem.

```
subagent({ agent: "plan-questioner", task: "<raw problem statement>" })
```

The questioner is designed to ask the user rather than assume — expect one or more rounds of back-and-forth. **Do not advance to Step 1 until the questioner has produced its final refined problem statement.** A plan built on wrong assumptions is worse than a slower plan built on confirmed understanding.

#### Step 1: Diverge (parallel proposals)
Choose the proposer pair based on the problem type:

**Minimal vs. clean-design** (default — for new features, refactors, greenfield work):
- `planner-opus` (Opus): smallest correct change, low risk, ship fast
- `planner-codex` (Codex): clean design, proper abstractions, future-proofed

**Local vs. systemic** (for bugs, regressions, recurring issues):
- `planner-local` (Opus): targeted fix scoped to the immediate problem area
- `planner-systemic` (Codex): root-cause fix that addresses the underlying pattern

Why these model assignments:
- **Opus for the contained proposals** (minimal, local): Opus excels at careful, restrained analysis — reading existing code precisely and finding the smallest correct intervention. Its conservatism is a feature here.
- **Codex for the expansive proposals** (clean-design, systemic): Codex's 400K context window lets it ingest more of the codebase, which matters when the task is to read broadly, find patterns across files, and think about system-level design. A different model family also provides genuine cognitive diversity — not variety for its own sake, but because different training produces different blind spots.

```
subagent({ tasks: [
  { agent: "planner-opus", task: "<refined problem statement>" },
  { agent: "planner-codex", task: "<refined problem statement>" }
]})
```

#### Step 2: Judge
Feed both proposals AND the original problem statement into `plan-judge` (Opus).

Why Opus for judging: The judge's core job is claim verification (spot-checking proposals against real code) and reasoning about tradeoffs — both are pure analytical tasks where Opus is strongest. The prompt explicitly forces it to assess local-vs-systemic fit from evidence, which counteracts any conservatism bias.

**Always include the original problem statement** so the judge evaluates proposals against the actual goal, not just against each other:

```
subagent({ agent: "plan-judge", task: "## Original problem\n<raw problem statement>\n\n## Proposal A\n<proposal A output>\n\n## Proposal B\n<proposal B output>" })
```

#### Degraded mode: one planner fails
If one planner fails (error, empty output, timeout), do NOT skip the judge or improvise. Instead:
1. **Tell the user** which planner failed and why (if known)
2. **Present options** and let the user decide:
   - **Retry** the failed planner (transient failures are common with external models)
   - **Run the judge on the single proposal** — it still adds value by verifying claims and checking for blind spots
   - **Skip the judge** and present the single proposal directly
3. Never substitute the questioner output for a missing proposal — the questioner defines the problem, it does not propose solutions

#### Step 3: Present & iterate
Show the user the recommended plan with the verdict. If the user wants changes, re-run the judge with their feedback (no need to re-run both planners unless the problem statement changed significantly).

## Session Hygiene

- Prefer starting new sessions (`/session new`) for unrelated tasks rather than using `/clear`
- `/clear` causes full cache misses — the entire context must be re-sent and re-cached, adding seconds of latency to the next turn and slowing down every subsequent response as context rebuilds
- Large accumulated context slows down every turn — the model processes more tokens, increasing latency. Keep sessions focused.
- For long implementation sessions (>50 tool calls), suggest compacting with `/compact` to reduce context size and speed up responses

## Service Design

- Prefer pure service objects over shared behavior via inheritance, base classes, mixins, modules, or concerns. Each service should be self-contained and explicit about its dependencies.
- Services should return a Result object (e.g., `Result.success(...)` / `Result.failure(...)`) rather than raising exceptions. Raising should be reserved for callers that need it (e.g., Temporal activities), not the services themselves.

## Temporal Activities

- Only Temporal activities should raise Temporal errors (e.g., `ApplicationError`). Services used by activities may also be called from GraphQL resolvers, jobs, or other contexts — they must not raise Temporal-specific errors.
- When handling failures in Temporal activities, differentiate between retryable and non-retryable errors:
  - **Retryable**: intermittent issues like network timeouts, rate limits, transient API errors — let these propagate or raise a retryable `ApplicationError`
  - **Non-retryable**: permanent failures like auth errors (401/403), not found (404), invalid input, missing files — raise `Temporal::Error::ApplicationError.new("...", non_retryable: true)` so Temporal does not waste retries

## Workflow

- Clean up any `.md` files created during planning or task coordination at the end of each step. Do not defer cleanup until the end of a task.

## Dotfiles & Pi Config Management

All pi configuration is versioned in `~/dotfiles/personal/pi/` and symlinked into `~/.pi/agent/`. When creating or modifying any pi resource (extensions, skills, agents, prompts, settings.json, AGENTS.md), always:

1. **Write the file to `~/dotfiles/personal/pi/<type>/`** — not directly into `~/.pi/agent/`
2. **Symlink into `~/.pi/agent/`** if a symlink doesn't already exist for that path
3. The symlink structure is:
   - `~/.pi/agent/AGENTS.md` → `~/dotfiles/personal/pi/AGENTS.md`
   - `~/.pi/agent/settings.json` → `~/dotfiles/personal/pi/settings.json`
   - `~/.pi/agent/agents/` → `~/dotfiles/personal/pi/agents/`
   - `~/.pi/agent/skills/` → `~/dotfiles/personal/pi/skills/`
   - `~/.pi/agent/prompts` → `~/dotfiles/personal/pi/prompts`
   - `~/.pi/agent/extensions/<name>` → `~/dotfiles/personal/pi/extensions/<name>` (per-extension symlinks)
4. Directory-level symlinks (agents, skills, prompts) mean new files inside them are automatically versioned — no extra symlinking needed
5. Extensions use per-extension symlinks (not a directory symlink) because `shopify-proxy` is managed externally via nix

## Git Safety

- Always highlight local git/graphite commands after executing them.
