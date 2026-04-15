# Personal Coding Preferences

## Tool Usage

- Never use `sed -n` to read file ranges — use the `read` tool with offset/limit parameters instead
- Never use `cat`, `head`, or `tail` to read files — use the `read` tool
- Never use `sed -i` for file edits — use the `edit` tool for surgical changes or `write` for full rewrites
- Prefer the native `grep`, `find`, and `ls` tools over their bash equivalents — they are faster, produce fewer tokens, respect .gitignore, and don't trigger bash-guard security reviews
- When exploring code, batch related reads into a single request when the files are independent

## Prefer Dedicated Tools Over Direct Access

Many external services have dedicated tools registered via pi extensions. **Always use a dedicated tool when one exists** instead of reaching for `fetch_content`, Chrome DevTools, `curl`, or direct API calls. Dedicated tools handle auth, pagination, rate limiting, and output formatting — direct access will usually fail or produce worse results. Do not use `fetch_content`, Chrome DevTools, or `curl` for a service that has a dedicated tool.

## Google Workspace Tools

Two sets of GWS tools are active — prefer based on operation type:

- **Calendar reads**: use `gws_calendar_list` / `gws_calendar_get` / `gws_calendar_today`
- **Calendar writes** (create/update/delete events, add/remove attendees): use `gcal_manage`
- **Calendar availability** (free/busy check): use `gcal_availability`
- **Gmail reads**: use `gws_gmail_list` / `gws_gmail_read` / `gws_gmail_search`
- **Gmail writes** (mark read, star, archive, trash): use `gmail_manage`
- **Drive search and metadata**: use `gws_drive_search` / `gws_drive_get`
- **Drive file content** (reading a Google Doc as text/markdown): use `gworkspace_read_file`
- **Docs, Sheets, Slides**: use `gws_docs_*` / `gws_sheets_*` / `gws_slides_*` exclusively

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

## Slack Message Formatting

- Use standard markdown (not Slack mrkdwn) — user has "Format messages with markup" enabled.
- Auto-copy final drafts to clipboard via `pbcopy`.

## Multi-Model Planning

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

- `planner-minimal`: smallest correct change, low risk, ship fast
- `planner-design`: clean design, proper abstractions, future-proofed

**Local vs. systemic** (for bugs, regressions, recurring issues):

- `planner-local`: targeted fix scoped to the immediate problem area
- `planner-systemic`: root-cause fix that addresses the underlying pattern

All planners and the judge use Opus for maximum proposal quality. Diversity comes from the prompt framing (conservative vs. expansive), not the model.

**Pre-loading files:** When the parent session already has the relevant code loaded in context, include file contents directly in the task prompt instead of making the subagent re-read them. This eliminates multi-turn tool-use latency (the biggest contributor to subagent wall time).

```
subagent({ tasks: [
  { agent: "planner-minimal", task: "<refined problem statement>" },
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

Show the user the recommended plan with the verdict, including the **Implementation Steps** section. If the user wants changes, re-run the judge with their feedback (no need to re-run both planners unless the problem statement changed significantly).

#### Step 4: Implement (optional)

If the user says "implement", "build it", or "go", load the `implement` skill. The judge's Implementation Steps section is the input — each step runs as an isolated subagent with only the files it needs, preventing context explosion.

For plans without the Implementation Steps section (legacy plans or external documents), the implement skill auto-decomposes via the `implementer-plan` agent.

## Session Hygiene

- Prefer starting new sessions (`/session new`) for unrelated tasks rather than using `/clear`
- `/clear` causes full cache misses — the entire context must be re-sent and re-cached, adding seconds of latency to the next turn and slowing down every subsequent response as context rebuilds
- Large accumulated context slows down every turn — the model processes more tokens, increasing latency. Keep sessions focused.
- **Use `/btw` for quick lookups** — syntax checks, API questions, "how does X work?" queries that are informational, not action-driving. Zero trace in conversation history. Press `p` to promote if the answer reveals something actionable, `n` to break out to a full session.
- **Use `/fork` + `/back` for tangents** — when a question turns into substantial work, `/fork` (or `Ctrl+Shift+F`) creates a new session from the current branch. Use `/back` to return to the parent session when done. When selecting a fork point, always pick a message **after** the first assistant response — forking from before the first response triggers a pi bug where the parent link isn't persisted.
- For long implementation sessions (>50 tool calls), suggest compacting with `/compact` to reduce context size and speed up responses
- When spawning a new tmux window, always give it a short descriptive name (e.g., `tmux new-window -n 'dev-server'`)
- When spawning a task into a separate tmux window (e.g., planning, investigation), treat that window as the user's workspace for that task. Don't pull results back into the parent session — it duplicates context and pollutes history, making it hard to scroll back to the original work (like a triage) that triggered the spawn. Just confirm the window is open and let the user work there directly.
- When spawning teammates via `team_spawn`, consider whether the task needs tools outside the default `code` preset. The tool auto-infers from keywords, but pass `preset` explicitly when the task domain is clear: `triage` (Slack/calendar/email), `investigate` (Observe/vault/data), `workspace` (Docs/Sheets/Slides), `code+` (browser/Figma), `experiment` (feature flags/grokt), `all` (cross-domain). If the default preset lacks a required tool, the teammate will fail silently.

## Service Design

- Prefer pure service objects over shared behavior via inheritance, base classes, mixins, modules, or concerns. Each service should be self-contained and explicit about its dependencies.
- Services should return a Result object (e.g., `Result.success(...)` / `Result.failure(...)`) rather than raising exceptions.
- Temporal activity patterns: see knowledge file `temporal-patterns.md` (auto-loaded when relevant).

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

When asked to review code, review a PR, or review current changes, load the `review` skill. It classifies the PR by change type, size, and risk to select 3-8 relevant reviewers (not all 15), dispatches them in sequential batches, validates findings with `review-judge`, and produces consolidated output. PR reviews are checked out into a WTP worktree so reviewers can read the full codebase.

When asked to review **multiple PRs** ("review these PRs", "batch review #1 #2 #3"), load the `batch-review` skill instead. It classifies all PRs, groups them into batches, gathers diffs via `bg_run`, dispatches reviewers from the lead via `subagent`, and gates between batches so you can approve/comment/request-changes before the next batch starts.

**Rules:**

- Never dispatch the review skill from inside a teammate — always from the lead or via `batch-review`
- Never use `team_spawn` for diff gathering — use `bg_run` (no tmux pane, no context overhead)
- Never use cron polling for review progress — `subagent` calls are blocking and return results directly

### Submitting review comments

- Don't duplicate between top-level comment and inline comments — they're visible together.
- Top-level: executive summary, validation results, numbered one-line finding list for orientation.
- Inline: self-contained full findings (problem, impact, suggested fix).

## PR Links

- When linking to PRs in the `shop/world` repo, **always use Graphite links** (`https://app.graphite.com/github/pr/shop/world/<number>`) instead of GitHub links (`https://github.com/shop/world/pull/<number>`). Graphite is the primary review interface.
- For repos outside `shop/world` that don't use Graphite, GitHub links are fine.

## PR Descriptions

- Don't mention tests — assumed. Don't include CI steps in test plan — CI handles those.
- Inline all validation steps (no local file paths). Use `<details>` for verbose scripts.
- Be concise. Lead with problem/solution.

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

When responding to Binks or assessing PR feedback, load the `binks-review` skill — it has the full response format, calibration feedback structure, and validity assessment framework.

## Loop Scheduler

Suggest `/loop` or `CronCreate` for: long-running deploys/builds, waiting on CI/PR state, periodic health checks, test watch loops. Don't suggest for things that complete in seconds.

## Autoresearch

Suggest autoresearch (`/skill:autoresearch-create`) for iterative optimization loops with a **measurable metric**: test speed, bundle size, build time, validation scores, memory usage. The agent loops autonomously: edit code → run benchmark → measure → keep improvements (git commit) / discard regressions (git revert) → repeat.

- Key tools: `init_experiment`, `run_experiment`, `log_experiment`. Dashboard: `Ctrl+X`.
- Key files: `autoresearch.md` (session playbook), `autoresearch.sh` (benchmark script), `autoresearch.checks.sh` (optional correctness gate)
- Don't suggest for: one-off bug fixes, non-measurable changes, changes requiring visual-only validation
- Use `/skill:autoresearch-finalize` to cherry-pick winning experiments into PRs after the session

## Git Safety

- **Never revert, checkout, or discard unstaged changes without explicit user approval.** Unstaged changes may be intentional work from other active sessions. Always assume they are. If there are conflicts or ambiguity with your task, ask before touching them. This includes `git checkout -- <file>`, `git restore`, `git stash`, and any command that would discard working tree changes.
- Always highlight local git/graphite commands after executing them.
- Never use `git commit` directly — use `gt modify` to amend the current commit, or `gt create` to start a new branch in the Graphite stack. The world repo uses Graphite for all branch/commit management.
- Never `git init` inside an existing git repository (creates nested repos). If a new standalone repo is needed, create it outside the current project tree first (e.g., `~/src/github.com/...`), then work there.
- Commit commands (`gt create`, `gt modify`, `gt absorb`) are gated by the bash-guard commit gate (Stage 1.5). On first commit in a session, you'll be prompted for a session-scoped policy: auto-allow all, confirm each, or deny. Change mid-session with `/guard commits auto|confirm|reset`.
- The commit gate listens for natural-language policy signals in user messages. Saying "allow commits", "auto-allow commits", or "commits are fine" at any point sets the policy to auto-allow. Saying "confirm commits" or "I want to approve each commit" sets it to confirm-each. You can also use `/guard commits auto|confirm|reset` directly.
- **Publishing PRs for review**: Never use `gh pr ready` — it only updates GitHub and doesn't sync to Graphite. Use `gt submit --publish` to move a PR from draft to published. This is the correct way to mark a PR ready for review in the Graphite workflow.
- **New branch work requires explicit approval before commit and submit.** When implementing new features or changes on a new branch, always pause and present the completed work for review **while changes are still unstaged**. Do not run `git add`, `gt create`, `gt modify`, or `gt submit` until the user approves. Present a summary of changes (files modified, key decisions, anything noteworthy) and wait for explicit greenlight. This does not apply to amendments on existing branches where the user has already reviewed the direction (e.g., CI fixes, review feedback).

## CI Triggering (shop/world)

CI no longer auto-runs on push (changed 4/13). Trigger explicitly with `devx ci run` after final submit. Full details in knowledge file `graphite-workflow.md` (auto-loaded when relevant).

## Judgment & Autonomy

- When the user asks "can you...?", "could you...?", or "is it possible to...?" — treat it as a question, not an instruction. Respond with analysis, options, or a proposal. Do not execute changes until the user confirms.
- When user says "I'll do this separately" or "I'll handle that", stop immediately. Don't attempt the action in a different way.
- When the user redirects with specific instructions (e.g., "move to X first", "use Y instead"), follow the redirect exactly — don't try to accomplish the original intent through a different path.
- If a bash command is blocked and the user provides instructions, follow those instructions precisely. Don't retry the same command with minor modifications (like piping `echo "y"` into it).
- When creating resources in external services (GitHub repos, deployments), confirm the target org/account/name with the user first. Don't assume defaults.
