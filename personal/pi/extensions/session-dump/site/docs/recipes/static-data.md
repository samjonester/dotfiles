# Static Data Files

Quick provides three platform data files available to every site. Fetch them from your site's root — no authentication needed.

All three files are NDJSON (one JSON object per line).

## directory.json

A directory of all Quick sites — what exists, when it was last updated, and a summary.

```javascript
const response = await fetch("/directory.json");
const sites = (await response.text()).trim().split("\n").map(JSON.parse);
```

**Fields:**

```json
{
  "uri": "gs://skai-train-quick/sites/my-app/index.html",
  "site_name": "my-app",
  "site_url": "https://my-app.quick.shopify.io",
  "last_updated": "2026-02-02 03:32:57.579 UTC",
  "site_summary": "Dashboard for tracking team metrics.",
  "last_modified_by": "alexsmith",
  "repo": "Shopify/my-repo",
  "commit_sha": "4076f3bc0881ecb511ef8f366c89372f25011618"
}
```

Not all fields are present for every site — `last_modified_by`, `repo`, and `commit_sha` only appear for sites deployed from a repo.

**Use cases:** Site discovery, search across Quick sites, building a Quick site directory/gallery.

## users.json

Shopify employee directory with Slack, GitHub, and org data.

```javascript
const response = await fetch("/users.json");
const users = (await response.text()).trim().split("\n").map(JSON.parse);
```

**Fields:**

```json
{
  "id": "12345",
  "name": "Alex Smith",
  "email": "alex@shopify.com",
  "title": "Senior Developer",
  "discipline_name": "Engineering",
  "group": "Core",
  "team_name": "Platform",
  "github": "alexsmith",
  "slack_handle": "alex.smith",
  "slack_id": "U012ABC3DEF",
  "slack_image_url": "https://cdn.shopify.com/..."
}
```

Not all fields are present for every user — only what's available.

**Use cases:** People finders, org charts, team pages, avatar lookups, @-mention autocomplete.

## usage.json

Per-site daily usage stats for a trailing 90-day window. Data is rolled daily for the previous reporting day.

```javascript
const response = await fetch("/usage.json");
const rows = (await response.text()).trim().split("\n").map(JSON.parse);
```

**Fields:**

```json
{ "site_name": "my-app", "category": "page_views", "day": "2026-01-09", "n": "142" }
```

**Categories:**

| Category | Description |
|---|---|
| `page_views` | HTML file requests |
| `unique_users` | Distinct users per day |
| `api_db`, `api_ai`, `api_dw`, `api_fs`, `api_slack`, `api_http`, `api_func`, `api_auth`, `api_id`, `api_mcp`, `api_sites` | API usage by endpoint |
| `socket_io` | WebSocket connections |
| `static_js`, `static_css`, `static_images`, `static_fonts`, `static_audio`, `static_video`, `static_data`, `static_downloads` | Static file requests by type |

**Use cases:** Usage dashboards, analytics, identifying active/inactive sites, tracking API use.

## Parsing Helper

Since all three files are NDJSON:

```javascript
async function fetchNDJSON(path) {
  const response = await fetch(path);
  const text = await response.text();
  return text.trim().split("\n").map(JSON.parse);
}

const sites = await fetchNDJSON("/directory.json");
const users = await fetchNDJSON("/users.json");
const usage = await fetchNDJSON("/usage.json");
```
