# quick init

Initialize a Quick project in the current directory. Downloads the latest `AGENTS.md` from Quick and creates a starter `index.html` if the directory is empty.

## Usage

```bash
quick init
```

## What It Does

1. Checks gcloud authentication (requires `gcloud auth login`)
2. Downloads the latest `AGENTS.md` from `gs://skai-train-quick/sites/quick/AGENTS.md`
3. Creates a `CLAUDE.md` symlink pointing to `AGENTS.md`
4. Creates a starter `index.html` if the directory has no visible files

## Prompts

- If `AGENTS.md` already exists, prompts to overwrite
- If `CLAUDE.md` already exists, prompts to overwrite

## Prerequisites

- `gcloud` CLI installed and authenticated (`gcloud auth login`)
