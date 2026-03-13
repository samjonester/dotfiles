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
When asked to "plan", "propose options", "evaluate approaches", or similar planning tasks, use the parallel subagent workflow:

1. **Diverge** — run `planner-opus` and `planner-codex` in parallel with the same problem statement. They have deliberately different philosophies:
   - **planner-opus** (Claude): minimal correct change, low risk, ship fast
   - **planner-codex** (Codex): clean design, proper abstractions, future-proofed
   The model difference AND framing difference together produce genuinely diverse proposals.
2. **Judge** — feed both proposals into `plan-judge` (Opus), which verifies claims against the codebase and synthesizes the right level of investment between the two extremes.
3. **Present** — show the user the recommended plan with the verdict.
4. **Iterate** — if the user wants changes, re-run the judge with their feedback (no need to re-run both planners unless the problem statement changed significantly).

Run the parallel planners first, then feed into the judge:
```
subagent({ tasks: [
  { agent: "planner-opus", task: "<problem statement>" },
  { agent: "planner-codex", task: "<problem statement>" }
]})
```
Then:
```
subagent({ agent: "plan-judge", task: "Evaluate these proposals:\n\n<proposals from above>" })
```

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

## Git Safety

- Always highlight local git/graphite commands after executing them.
