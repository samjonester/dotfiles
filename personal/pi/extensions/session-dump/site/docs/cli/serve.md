# quick serve

Start a local dev server for previewing Quick sites. Serves static files with a service worker that proxies Quick APIs (db, ai, fs, etc.) to production.

## Usage

```bash
quick serve [dir] [sitename]
quick serve [dir] [sitename] --port 3000
```

## Arguments

| Argument | Default | Description |
|---|---|---|
| `dir` | `.` | Directory to serve |
| `sitename` | directory name | Site name (used for subdomain-based API routing) |

## Options

| Flag | Default | Description |
|---|---|---|
| `-p, --port <port>` | `1337` | Port number (auto-increments if in use) |

## Example

```bash
# Serve current directory
quick serve

# Serve specific directory as "my-app"
quick serve ./dist my-app

# Custom port
quick serve . my-app -p 8080
```

## How It Works

1. Starts HTTP server on `http://<sitename>.quick.localhost:<port>`
2. Serves static files from the directory
3. Redirects `/client/quick.js` to the production Quick client (with local storage adapters)
4. Injects a service worker that proxies API calls (`/api/*`) to `quick.shopify.io`
5. SPA support: falls back to `200.html` for unmatched routes

## Features

- **Full API access**: All Quick APIs (db, ai, fs, socket, etc.) work via service worker proxy
- **SPA routing**: If `200.html` exists, it serves as the fallback for client-side routing
- **Auto port increment**: If port is taken, tries the next one
- **No-cache headers**: All files served without caching for fast iteration
