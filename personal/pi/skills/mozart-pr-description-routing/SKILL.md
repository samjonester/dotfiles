---
name: mozart-pr-description-routing
description: Route Mozart PR description generation to the correct validation skill based on changed files. Use when asked to generate, draft, or write a PR description for Mozart.
---

# Mozart PR Description Routing

Use this skill whenever the user asks to generate/draft/write a PR description in Mozart.

## Goal

Automatically choose which validation section(s) to include:
- Frontend validation (`mozart-fe-validation`)
- Backend validation (`mozart-be-validation`)
- Both, when the diff spans both layers

## 1) Detect changed files first

Run one or more of:

```bash
git diff --name-only origin/main...HEAD
git diff --name-only HEAD~1...HEAD
git diff --name-only --cached
git diff --name-only
```

Use the first non-empty result.

## 2) Classify the diff

### Frontend indicators
- `web/**`
- `playwright/**`
- `.storybook/**`
- `vite.config.*`
- FE-only package/tooling updates

### Backend indicators
- `app/**`
- `db/**`
- `config/**` (backend/runtime/schema-related)
- `lib/**`
- `proto/**`
- Ruby/backend test files

## 3) Load validation skills by classification

- FE-only diff → read `~/dotfiles/personal/pi/skills/mozart-fe-validation/SKILL.md`
- BE-only diff → read `~/dotfiles/personal/pi/skills/mozart-be-validation/SKILL.md`
- Mixed diff → read both and include both validation sections
- Unclear diff → include both and clearly note assumptions

## 4) PR description requirements

Always include:
1. Summary
2. Risks/impact
3. Validation section(s) selected from routing

Validation sections must include:
- `/opt/dev/bin/dev server` step
- seed + cleanup when needed
- disposable script(s)
- exact run commands
- expected output and artifact paths

## 5) Make routing explicit

Include one line in the response before (or within) the PR description:
- `Validation routing: FE`
- `Validation routing: BE`
- `Validation routing: FE+BE`

This makes the choice auditable for reviewers.
