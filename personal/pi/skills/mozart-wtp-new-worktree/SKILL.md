---
name: mozart-wtp-new-worktree
description: Create or resume a fresh Mozart development worktree using WTP. Use when the user asks to start fresh development in a new worktree, create a branch worktree, or switch to an isolated slot for a new task.
---

# Mozart WTP: New Worktree for Fresh Development

Use this skill when the user wants a fresh development slot for Mozart.

## Inputs

- Required: target branch name (e.g. `sam/feature-x`)
- Optional: whether to start the dev server immediately

## 1) Preconditions

Run from Mozart zone (`.../areas/platforms/mozart`).

Run the prerequisites from [../\_shared/wtp-checkout.md](../_shared/wtp-checkout.md), then check pool state:

```bash
$WTP_BIN status
```

If pool does not exist, instruct user to initialize one (expensive first-time setup):

```bash
wtp init 2
# or
wtp grow 1
```

## 2) Claim slot and prepare runtime

Set `BRANCH` to the target branch name, then follow the WTP checkout flow in [../\_shared/wtp-checkout.md](../_shared/wtp-checkout.md) (prerequisites → claim → sync → prepare runtime).

All subsequent commands run from `$TARGET_DIR`.

## 3) Start development (optional)

```bash
cd "$TARGET_DIR"
/opt/dev/bin/dev server
```

## 4) Report back

Always return:

- branch
- claimed slot path
- whether resumed vs newly claimed
- service readiness result
- whether server was started

## 6) Safety / cleanup reminders

- To release slot after work:

```bash
wtp free
```

- If branch merged and slot clean:

```bash
wtp gc
```
