# quick deploy

Deploy a directory to a Quick subdomain. Files are synced to Google Cloud Storage and served at `<subdomain>.quick.shopify.io`.

## Usage

```bash
quick deploy <dir> [subdomain]
quick deploy <dir> <subdomain> --force
quick deploy <dir> <subdomain> --watch
```

## Arguments

| Argument | Required | Description |
|---|---|---|
| `dir` | Yes | Directory to deploy (must contain `index.html` or `200.html`) |
| `subdomain` | No | Target subdomain. If omitted, prompts for random or custom name |

## Options

| Flag | Description |
|---|---|
| `-f, --force` | Skip overwrite confirmation |
| `-w, --watch` | Watch for changes and redeploy automatically |

## Example

```bash
# Deploy dist/ to my-app.quick.shopify.io
quick deploy dist my-app

# Deploy with watch mode (auto-redeploy on file changes)
quick deploy . my-app --watch

# No subdomain — prompts for random or custom
quick deploy .
```

## Behavior

1. Validates subdomain (lowercase, max 63 chars, no periods)
2. Validates directory (must contain `index.html` or `200.html`)
3. Checks gcloud authentication
4. If site exists, prompts for overwrite confirmation
   - Own site: simple y/n
   - Someone else's site: must type exact site name
5. Warns if deploying more than 1,000 files
6. Syncs files via `gcloud storage rsync` (excludes `node_modules`, lockfiles, dotfiles, `AGENTS.md`, `CLAUDE.md`)
7. Sets `modified-by` metadata on uploaded files

## Prerequisites

- `gcloud` CLI installed and authenticated
- Directory must contain `index.html` or `200.html`
