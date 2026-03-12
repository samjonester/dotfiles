---
name: devx-skills
description: 'Install and manage agent skills from the devx skills repo. Use when: (1) user says "add skill", "install skill", or "devx skills", (2) user wants to browse or search available skills. Always installs to ~/.pi/agent/skills/ for personal use unless the user explicitly asks to install to the project.'
---

# DevX Skills Management

## Principle

Skills installed into a project directory (e.g., `.claude/skills/`) show up as untracked files in git and may duplicate skills the project already provides. Personal skills belong in `~/.pi/agent/skills/`.

## Install a Skill

```bash
cd ~/.pi/agent/skills && devx skills add <name>
```

Always `cd` first — `devx skills add` installs into the current directory.

## Install to Project (only when explicitly requested)

```bash
cd <project-root>/.claude/skills && devx skills add <name>
```

## Before Installing

Check for conflicts — the project may already have the skill:

```bash
# List project skills (from project root)
ls .agents/skills/ .claude/skills/ .pi/skills/ 2>/dev/null
```

If the skill already exists in the project, tell the user and skip the install.

## List Available Skills

```bash
devx skills list
```

## List Installed Personal Skills

```bash
ls ~/.pi/agent/skills/
```
