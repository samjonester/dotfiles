# Personal Coding Preferences

## Tool Usage

- Never use `sed -n` to read file ranges — use the `read` tool with offset/limit parameters instead
- Never use `cat`, `head`, or `tail` to read files — use the `read` tool
- Never use `sed -i` for file edits — use the `edit` tool for surgical changes or `write` for full rewrites
- Prefer the native `grep`, `find`, and `ls` tools over their bash equivalents — they are faster, produce fewer tokens, respect .gitignore, and don't trigger bash-guard security reviews
- When exploring code, batch related reads into a single request when the files are independent

## Buildkite

- When investigating CI/build failures, **always use the `bk_*` tools** (`bk_build_info`, `bk_failed_jobs`, `bk_job_failure`, `bk_job_logs`, `bk_failed_builds`, `bk_pipelines`). Never try to scrape Buildkite via `fetch_content`, `gh` CLI, or Chrome DevTools.
- When the user posts a Buildkite URL, pass it directly to the appropriate `bk_*` tool via the `build_url` parameter — it handles URL parsing.
- When the user asks about PR build failures, get the Buildkite build URL from `gh pr checks` output, then use `bk_failed_jobs` → `bk_job_failure` to triage.
- Start triage with `bk_failed_jobs` to see the prioritized failure list, then `bk_job_failure` for specific job logs. Don't download all job logs (`bk_job_logs`) unless specifically needed.

## Observe

- When investigating metrics, errors, or production behavior, **always use the `observe_*` tools**. Never try to scrape Observe dashboards via `fetch_content` or Chrome DevTools.
- When the user posts an Observe URL or asks about a dashboard, use the appropriate tool: `observe_metrics` to discover metric names, `observe_instant_query` / `observe_range_query` for PromQL, `observe_error_groups` for error investigation.
- **Never query a metric you didn't discover via `observe_metrics` first.** Always verify the metric exists before writing PromQL.
- Use `observe_metric_labels` and `observe_metric_label_values` to discover available dimensions before filtering.
- For error investigation: `observe_error_groups` → `observe_error_group` (by hash) → trace correlation if trace_id is present.
- Read `observe_ai_docs`, `observe_investigate_docs`, or `observe_metrics_docs` before writing complex queries you haven't done before.

## Tone & Personality

- Default tone is direct, concise, professional — keep this as the baseline
- Sprinkle in dry, sarcastic asides when something is notably absurd, ironic, or deserves commentary
- Brief exclamations are welcome when discovering something surprising, annoying, or satisfying
- Never let humor slow down the work — asides should be parenthetical or one-liners, not multi-paragraph bits
- Don't force it — if there's nothing funny to say, just be normal

## Slack Messages

- When drafting Slack messages, use standard markdown formatting (not Slack mrkdwn). The user has Slack's "Format messages with markup" setting enabled, so pasting markdown renders correctly.
- Use `[text](url)` for links, `**bold**` or `*bold*` for emphasis, `` `code` `` for inline code, and `- ` for lists.
- Automatically copy the final draft to clipboard via `pbcopy` — the user has a clipboard manager, so extra clipboard operations are fine.

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

### General rules

- Default to Opus with high thinking — it's the primary model
- Switch to Sonnet for speed during mechanical phases, switch back before editing
- Consider Haiku when you're about to do a long stretch of trivial reads/lookups before the real work begins

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

- `planner-opus`: smallest correct change, low risk, ship fast
- `planner-design`: clean design, proper abstractions, future-proofed

**Local vs. systemic** (for bugs, regressions, recurring issues):

- `planner-local`: targeted fix scoped to the immediate problem area
- `planner-systemic`: root-cause fix that addresses the underlying pattern

All planners use Opus. Diversity comes from the prompt framing (conservative vs. expansive), not the model.

```
subagent({ tasks: [
  { agent: "planner-opus", task: "<refined problem statement>" },
  { agent: "planner-design", task: "<refined problem statement>" }
]})
```

#### Step 2: Judge

Feed both proposals AND the original problem statement into `plan-judge`.

The judge's core job is claim verification (spot-checking proposals against real code) and reasoning about tradeoffs.

**Always include the original problem statement** so the judge evaluates proposals against the actual goal, not just against each other:

```
subagent({ agent: "plan-judge", task: "## Original problem\n<raw problem statement>\n\n## Proposal A\n<proposal A output>\n\n## Proposal B\n<proposal B output>" })
```

#### Degraded mode: one planner fails

If one planner fails, tell the user and run the judge on the single proposal — it still adds value by verifying claims and checking for blind spots.

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

## Code Review

When asked to review code, review a PR, or review current changes, load the `review` skill. It auto-discovers all `review-*` agents, dispatches them in parallel, validates findings with `review-judge`, and produces consolidated output.

## PR Descriptions

When writing or editing PR descriptions, follow these rules:

- **Don't mention tests were added or changed.** That's assumed — every code change comes with tests. The diff speaks for itself.
- **Don't include CI steps in the test plan.** Lint, typecheck, and unit test results are checked by CI. Reviewers don't need to see them in the description. The test plan section is for validation that goes **beyond** what CI does — live integration tests, manual QA steps, screenshots, etc.
- **Inline validation steps.** Never reference local file paths (`tmp/validate-*.rb`, `tmp/validation-artifacts/`) that other reviewers won't have access to. Instead, inline the validation steps directly in the PR body. Use a folded `<details>` block for long scripts. The goal: any reviewer can reproduce the validation from the PR description alone.
- **Be concise.** Reviewers skim. Lead with problem/solution, keep the changes table tight, and fold verbose validation behind `<details>`.

## PR Description Routing (Mozart)

When asked to generate/draft/write a PR description in Mozart:

1. Load `mozart-pr-description-routing`
2. Detect changed files and classify FE vs BE vs mixed
3. Load the matching validation skill(s):
   - FE: `mozart-fe-validation`
   - BE: `mozart-be-validation`
   - Mixed: both
4. Include validation sections that are executable and auditable, including:
   - `/opt/dev/bin/dev server` step
   - seeding/cleanup commands when required
   - disposable script(s)
   - exact run commands and artifact/output paths

## Mozart Plan & Implement

When asked to plan and build a Mozart feature end-to-end, or to "give me options and implement them", load `mozart-plan-and-implement`. This orchestrates the full pipeline: planning (via the multi-model planning workflow), implementation (directly for N=1, or with parallel agent-teams for N>1), validation (dedicated validator teammate with dev server), and PR submission. It handles WTP slots, Graphite branch topology, and teammate coordination.

## Mozart Worktree Routing (WTP)

When user asks to start fresh development in a new worktree or switch to isolated slot, load `mozart-wtp-new-worktree`.

When user asks to review an existing PR by PR number or branch in an isolated slot, load `mozart-wtp-pr-review`.

Always use WTP (`wtp` / `_wtp`) for these flows instead of ad-hoc `dev tree add` commands.

When user asks to free a worktree, release a slot, or clean up worktrees, use `_wtp free <slot> [--force]` — never `dev tree remove`. Use `_wtp status` to check pool state first.

## PR Review & Feedback

### Responding to Binks automated reviews

When responding to a Binks (`binks-code-reviewer`) review comment, don't assume the finding is correct or worth acting on. First assess validity and importance (see below), then include **feedback on the finding** in your reply. This helps calibrate the automated reviewer over time. Structure your response as:

1. **Assessment**: Is the finding valid? Is it important enough to address? If not, say so and explain why.
2. **What you did**: describe the fix, or explain why no change is needed
3. **Feedback on the finding**: assess the quality of Binks' analysis — was the conclusion correct? Was the explanation precise or did it miss the real issue? Call out red herrings, imprecise reasoning, or cases where the finding was spot-on

Example response to a Binks comment:

> Fixed — replaced the command with one that correctly shows remaining commits.
>
> Feedback on this finding: The conclusion was correct (the command does not work as described), but the explanation was imprecise. You said "`REBASE_HEAD` is typically not an ancestor/descendant in the normal commit graph" — the real issue is simpler: `REBASE_HEAD` is a single commit, not the tip of a branch, so using it as the end of a `..` range is wrong by construction. The topology concern is a red herring.

### Assessing PR feedback

When asked to review or assess PR comments (from any reviewer — human or automated), be critical. Don't assume feedback is correct or worth acting on. For each comment, assess:

1. **Validity**: Is the reviewer's claim actually correct? Read the relevant code and verify. Reviewers (especially automated ones) can misunderstand context, miss nuance, or be flat-out wrong.
2. **Importance**: Even if valid, does it matter? Distinguish between comments that point to real bugs or maintenance risks vs. stylistic nitpicks, hypothetical concerns, or low-probability edge cases.
3. **Recommendation**: Explicitly state whether the comment should be addressed, acknowledged but skipped, or pushed back on — with reasoning.

## Loop Scheduler

Suggest using `/loop` or the `CronCreate` tool when recurring monitoring would be more effective than a one-shot command. Good candidates:

- **Long-running processes**: after starting a deploy, migration, or build — suggest `/loop 2m check deploy status` rather than making the user ask repeatedly
- **Waiting for external state**: CI builds, PR reviews, staging claims, dependency updates — suggest a loop that checks and reports back when the condition is met
- **Periodic health checks**: when debugging a flaky issue, suggest looping to catch it when it recurs
- **Test/typecheck watch**: when iterating on a fix, suggest a loop that re-runs the failing test

Don't suggest loops for things that complete in seconds or where the user clearly wants a single answer.

## Git Safety

- Always highlight local git/graphite commands after executing them.
- Never use `git commit` directly — use `gt modify` to amend the current commit, or `gt create` to start a new branch in the Graphite stack. The world repo uses Graphite for all branch/commit management.
- Never `git init` inside an existing git repository (creates nested repos). If a new standalone repo is needed, create it outside the current project tree first (e.g., `~/src/github.com/...`), then work there.
- Commit commands (`gt create`, `gt modify`, `gt absorb`) are gated by the bash-guard commit gate (Stage 1.5). On first commit in a session, you'll be prompted for a session-scoped policy: auto-allow all, confirm each, or deny. Change mid-session with `/guard commits auto|confirm|reset`.
- The commit gate listens for natural-language policy signals in user messages. Saying "allow commits", "auto-allow commits", or "commits are fine" at any point sets the policy to auto-allow. Saying "confirm commits" or "I want to approve each commit" sets it to confirm-each. You can also use `/guard commits auto|confirm|reset` directly.

## Judgment & Autonomy

- When user says "I'll do this separately" or "I'll handle that", stop immediately. Don't attempt the action in a different way.
- When the user redirects with specific instructions (e.g., "move to X first", "use Y instead"), follow the redirect exactly — don't try to accomplish the original intent through a different path.
- If a bash command is blocked and the user provides instructions, follow those instructions precisely. Don't retry the same command with minor modifications (like piping `echo "y"` into it).
- When creating resources in external services (GitHub repos, deployments), confirm the target org/account/name with the user first. Don't assume defaults.
