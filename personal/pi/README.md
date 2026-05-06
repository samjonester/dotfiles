# Pi Configuration

Personal [pi](https://github.com/mariozechner/pi) agent configuration. Dotfiles is registered as a **pi package** in `settings.json`, so most resources auto-discover via `package.json` → `pi.*` manifest. `install.sh` only handles cross-package wiring (agents, optional shop-pi-fy extensions).

## Directory layout

```
personal/pi/
├── package.json       Declares this dir as a pi package; pi.extensions/skills/prompts/themes auto-discover
├── AGENTS.md          → ~/.pi/agent/AGENTS.md (system prompt additions)
├── settings.json      → ~/.pi/agent/settings.json
├── keybindings.json   Custom keybindings layered onto pi-core defaults
├── presets.json       Preset definitions (code, investigate, all, etc.)
├── models.json        Provider/model overrides (e.g. maxTokens for 250k-context Anthropic provider)
├── auto-lint.json     Auto-lint rules
├── agents/            Symlinked file-by-file into ~/.pi/agent/agents/ (layered with shop-pi-fy agents)
├── extensions/        Auto-loaded by package mechanism (no symlinks needed)
├── skills/            → ~/.pi/agent/skills/
├── prompts/           → ~/.pi/agent/prompts/
├── themes/            → ~/.pi/agent/themes/
└── knowledge/         Public knowledge files; symlinked into ~/.pi/memory/knowledge/
```

## How extensions load

Three sources, in this order:

1. **Dotfiles** — `personal/pi/extensions/` auto-discovered via `package.json` → `pi.extensions: ["./extensions"]`. Every subdirectory's `index.ts` and every top-level `.ts` file becomes an extension.
2. **Pi packages from npm** — `pi-web-access`, `pi-messenger`, `pi-tool-display` etc., declared in `settings.json` → `packages`.
3. **shop-pi-fy** (Shopify-only workplace package) — installed via `pi install`, then `install.sh` symlinks individual extensions from the package clone into `~/.pi/agent/extensions/`.

Pi's `core/extensions/runner.js:getAllRegisteredTools` dedupes by **first-wins, silently** when multiple extensions register the same name. The dotfiles package loads before shop-pi-fy per `settings.json` packages order. Some upstream extensions (notably `agent-teams`) check for prior registration and **explicitly defer** — e.g. agent-teams skips registering `subagent` if another extension already did. So fork-overrides are well-behaved when upstream cooperates.

## Forks of upstream extensions

The following dotfiles extensions intentionally **override** their shop-pi-fy upstream counterparts. `install.sh`'s skip list excludes them so the upstream symlink isn't created (which would cause double event-handler registration).

| Extension | Why dotfiles forks it |
|---|---|
| `bash-guard` | LLM-jury security guard with custom heuristics |
| `context-viz` | Personal display tweaks |
| `memory` | Persistent memory bank |
| `notify` | Custom notification rules |
| `retitle` | Out-of-band Haiku-based session naming — refines name across first 3 turns, respects manual renames |
| `shell-mode` | Personal shell-mode behavior |
| `subagent` | Subprocess-based delegation. Upstream `agent-teams` defers to this fork's registration (see agent-teams/index.ts:333). |

When syncing with upstream pi-core changes, **check each fork's README** for the upstream-tracking note.

## Dotfiles-only extensions

These have no shop-pi-fy upstream — they're personal extensions that exist only here:

| Extension | Purpose |
|---|---|
| `custom-footer` | Custom footer: session title, CWD, token stats, context %, model, extension statuses |
| `lfg` | `/lfg` quick-launch shortcuts |
| `pi-autoresearch` | Autoresearch loop tooling (init/run/log experiments) |
| `pi-figma-remote-mcp` | Figma MCP bridge configuration |
| `pitw` | Pi tmux/window helpers |
| `tm` | Tmux pane management |
| `preset.ts` | Preset loading + `pendingToolValidation` mechanism for async-loaded tool extensions |

## Agent files

`~/.pi/agent/agents/` is a real directory built by `install.sh` from two sources:

1. Dotfiles agents (`personal/pi/agents/*.md`) — planners, custom reviewers, task runners
2. shop-pi-fy package agents (if installed) — `review-architecture`, `review-correctness`, `review-scope`, etc.

Both sources coexist; dotfiles symlinks are created first, then shop-pi-fy symlinks layer on top of any non-conflicting names.

### Tool name maintenance

Agent `tools:` frontmatter must reference **registered tool names** at runtime. When pi-core or extensions rename tools (e.g., `vault_search` → `vault_list_tools` + `vault_call_tool`), update each agent file's tools list. The dotfiles `subagent/agents.ts` parses `tools:` defensively (string `"a, b"`, flow array `[a, b]`, block array, or null) but won't catch stale names — those just become "unknown tool" warnings in subagent runs.

## Adding a new dotfiles extension

1. Create `personal/pi/extensions/<name>/index.ts` (or `personal/pi/extensions/<name>.ts` for a single-file extension)
2. **No further wiring needed** — `package.json` auto-discovery picks it up on next pi reload
3. If `<name>` exists in shop-pi-fy upstream, add it to the skip list in `install.sh` → `setup_pi()` to prevent duplicate loading

## Settings & keybindings layering

- `settings.json` → packages list, presets, picker config
- `keybindings.json` → custom shortcuts (only entries that override pi-core defaults need to appear)
- `presets.json` → preset definitions; the `code`, `investigate`, `all` presets are heavily customized with Mozart MCP tools

## Memory bank

`~/.pi/memory/knowledge/` is a real directory with both:
- Public (dotfiles-versioned) knowledge files in `personal/pi/knowledge/`, symlinked file-by-file
- Local (private, machine-specific) knowledge files added directly to `~/.pi/memory/knowledge/`
