# Pi Configuration

Personal [pi](https://github.com/mariozechner/pi) agent configuration, versioned in dotfiles and symlinked into `~/.pi/agent/` by `install.sh`.

## Directory layout

```
personal/pi/
├── AGENTS.md          → ~/.pi/agent/AGENTS.md (system prompt additions)
├── settings.json      → ~/.pi/agent/settings.json
├── auto-lint.json     → ~/.pi/agent/auto-lint.json
├── agents/            → ~/.pi/agent/agents/ (planner agents, layered with package agents)
├── extensions/        → ~/.pi/agent/extensions/ (first-party only)
│   ├── bash-guard/    Security guard: LLM jury votes on risky bash commands
│   └── git-safety.ts  Confirmation gate for remote git/gh/gt mutations
├── skills/            → ~/.pi/agent/skills/
└── prompts/           → ~/.pi/agent/prompts/
```

## Extension sources

Extensions load from multiple places:

1. **Dotfiles** (`personal/pi/extensions/`) — portable, first-party code versioned here
2. **Pi packages** (`settings.json` → packages) — `pi-web-access`, `pi-messenger`, `pi-tool-display`
3. **Workplace packages** (optional) — installed via `pi install <url>`, wired at install time by `install.sh` → `setup_pi()`

Extensions from workplace packages are **not** stored in dotfiles. `install.sh` symlinks them from the pi package clone into `~/.pi/agent/extensions/` at install time. On machines without the package, these blocks are safe no-ops.

## Avoiding duplicate registration

Pi packages declare which extensions auto-load via `package.json` → `.pi.extensions`. Those must **not** also be symlinked into `~/.pi/agent/extensions/` or every tool registers twice.

`install.sh` maintains a skip-list of package-registered extension names to prevent this. If you add a new pi package that exports extensions, check its `package.json` and add any declared extensions to the skip-list in `setup_pi()`.

Similarly, if a package extension conflicts with an npm package tool (e.g. both provide `web_search`), add it to the skip-list and keep whichever is more capable.

## Adding a new first-party extension

1. Create the extension in `personal/pi/extensions/<name>/`
2. Add `<name>` to the `PI_LOCAL_EXTENSIONS` array in `setup_pi()` in `install.sh`
3. Run `install.sh` or manually `ln -vsfn` it into `~/.pi/agent/extensions/`

## Agent layering

`~/.pi/agent/agents/` is a **real directory** (not a symlink), built by `install.sh` from:

1. Dotfiles agents (`personal/pi/agents/*.md`) — planners, questioners
2. Workplace package agents (if installed) — reviewer personas, etc.

This lets both sources coexist without either overwriting the other.

---

## Portable extensions worth replicating

These extensions from the workplace package have **no** internal infrastructure dependencies and could be installed or recreated on any machine.

| Extension                  | Tools / Commands                                               | Description                                                          |
| -------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------- |
| **auto-lint**              | `/lint-toggle`, `/lint-reload`                                 | Auto-format files on save via configurable rules                     |
| **background-jobs**        | `bg_run`, `bg_list`, `bg_log`, `bg_stop`, `bg_wait`            | Run long processes in background, read logs                          |
| **chrome-devtools**        | (via skill)                                                    | Chrome browser automation and inspection                             |
| **investigator**           | `log_finding`                                                  | Structured investigation logging (hypotheses, findings, conclusions) |
| **loop-scheduler**         | `/loop`                                                        | Recurring prompt scheduler (e.g. `/loop 2m check CI`)                |
| **memory**                 | `memory_read`, `memory_update`, `memory_append`, `memory_list` | Persistent memory bank across sessions                               |
| **no-sleep-while-working** | —                                                              | Prevent macOS sleep during active agent work                         |
| **notify**                 | `/notify`                                                      | Desktop notifications                                                |
| **output-guard**           | `read_output_chunk`, `search_output`                           | Truncate large tool outputs, provide chunked reading                 |
| **pkg**                    | `/pkg`                                                         | Unified package manager for pi resources                             |
| **prefer-graphite**        | —                                                              | Prefer Graphite `gt` over raw git for branch management              |
| **retitle**                | `/retitle`, `/retitle-all`                                     | Auto-name sessions via LLM                                           |
| **subagent**               | `subagent`                                                     | Delegate tasks to specialized agents                                 |
| **vim-mode**               | —                                                              | Modal editing with operators, motions, counts                        |

## Dotfiles agents

Agents versioned here (in `agents/`). Planner agents power the multi-model planning workflow; review agents are dispatched by the `review` skill orchestrator.

### Planners

| Agent              | Model  | Role                                             |
| ------------------ | ------ | ------------------------------------------------ |
| `plan-questioner`  | Sonnet | Sharpen problem statement before planning begins |
| `planner-opus`     | Opus   | Minimal / locally-scoped proposal                |
| `planner-codex`    | Codex  | Clean-design / forward-looking proposal          |
| `planner-local`    | Opus   | Targeted fix scoped to immediate problem area    |
| `planner-systemic` | Codex  | Root-cause fix addressing underlying pattern     |
| `plan-judge`       | Opus   | Evaluate proposals, verify claims, synthesize    |

### Reviewers (custom — complement shop-pi-fy's `review-*` agents)

| Agent                | Model  | Focus                                                         |
| -------------------- | ------ | ------------------------------------------------------------- |
| `review-design`      | Opus   | Reads beyond the diff — callers, callees, design context      |
| `review-simplify`    | Sonnet | Reduce complexity, remove unnecessary abstractions            |
| `review-consistency` | Sonnet | Flags patterns diverging from codebase majority               |
| `review-naming`      | Sonnet | Variable, method, class naming quality and clarity            |
| `review-readability` | Sonnet | Cognitive complexity, control flow, information density       |
| `review-intent`      | Sonnet | PR description vs actual code alignment (PR reviews only)     |
| `review-judge`       | Opus   | Validates all findings, filters false positives, consolidates |
