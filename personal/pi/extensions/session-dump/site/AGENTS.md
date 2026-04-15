---

# Quick

[Quick](https://quick.shopify.io) is Shopify's internal platform for hosting static sites with serverless APIs. Sites are behind Google IAP — only Shopify employees can access them. Each site lives at `<subdomain>.quick.shopify.io`.

## Key Principles

- Quick sites are **frontend only** — static HTML, CSS, JS. No backend.
- Every site must have an `index.html` (or `200.html` for SPA routing).
- Functionality comes from Quick's APIs, not custom servers.
- Include the client library: `<script src="/client/quick.js"></script>`
- Do not add real-time/WebSocket features unless explicitly asked.

## Client Library

Include via script tag. All APIs are on the `quick` global:

```html
<script src="/client/quick.js"></script>
```

### Database (`quick.db`) — [full docs](docs/client/db.md)

Note: Each object in a collection has a maximum size of 1MB.

```javascript
const posts = quick.db.collection("posts");
const doc = await posts.create({ title: "Hello" });
const all = await posts.find();
const one = await posts.findById("id");
await posts.update("id", { title: "Updated" });
await posts.delete("id");

// Query
const results = await posts
  .where({ status: "published" })
  .orderBy("created_at", "desc")
  .limit(10)
  .find();

// Real-time
const unsub = posts.subscribe({
  onCreate: (doc) => {},
  onUpdate: (doc) => {},
  onDelete: (id) => {},
});
```

### AI (`quick.ai`) — [full docs](docs/client/ai.md)

The `/api/ai` endpoint is an OpenAI-compatible proxy. Use the OpenAI SDK directly:

```javascript
import OpenAI from "https://cdn.jsdelivr.net/npm/openai/+esm";
const client = new OpenAI({ baseURL: `/api/ai`, apiKey: "not-needed", dangerouslyAllowBrowser: true });

const stream = await client.chat.completions.create({
  model: "gpt-5.2",
  messages: [{ role: "user", content: "Hello" }],
  stream: true,
});
for await (const chunk of stream) {
  const content = chunk.choices[0]?.delta?.content;
  if (content) console.log(content);
}
```

### File Storage (`quick.fs`) — [full docs](docs/client/fs.md)

```javascript
const result = await quick.fs.uploadFile(file, {
  onProgress: ({ percentage }) => console.log(`${percentage}%`),
});
// => { url, fullUrl, size, mimeType }
```

### WebSocket (`quick.socket`) — [full docs](docs/client/socket.md)

```javascript
const room = quick.socket.room("lobby");
room.on("user:join", (user) => console.log(user.name, "joined"));
room.on("user:state", (prev, next, user) => {});
await room.join();
room.updateUserState({ cursor: { x: 100, y: 200 } });
room.emit("ping", { t: Date.now() });
```

### User Identity (`quick.id`) — [full docs](docs/client/id.md)

```javascript
const user = await quick.id.waitForUser();
// => { email, fullName, slackHandle, slackImageUrl, title, github, team, ... }
quick.id.email; // direct access
```

### Other APIs

- **Site Management** (`quick.site`) — [full docs](docs/client/site.md): Create, get, delete sites programmatically
- **Data Warehouse** (`quick.dw`) — [full docs](docs/client/dw.md): Query BigQuery (requires OAuth via `quick.auth.requestScopes`)
- **Slack** (`quick.slack`) — [full docs](docs/client/slack.md): Send messages, alerts, tables to Slack
- **HTTP Proxy** (`quick.http`) — [full docs](docs/client/http.md): Proxy requests to external APIs (bypasses CORS)
- **Cloud Functions** (`quick.func`) — [full docs](docs/client/func.md): Call GCP Cloud Functions/Cloud Run with IAP auth
- **Auth** (`quick.auth`) — [full docs](docs/client/auth.md): OAuth for Google, GitHub, Slack (popup-based flows)

## CLI

Install: `npm install -g @shopify/quick`

| Command | Description | [Docs](docs/cli/) |
|---|---|---|
| `quick init` | Initialize project (downloads AGENTS.md, creates starter files) | [init.md](docs/cli/init.md) |
| `quick deploy <dir> <subdomain>` | Deploy directory to subdomain | [deploy.md](docs/cli/deploy.md) |
| `quick serve [dir] [sitename]` | Local dev server with full API access | [serve.md](docs/cli/serve.md) |
| `quick auth` | Authenticate for MCP (Google OAuth) | [auth.md](docs/cli/auth.md) |
| `quick mcp [site]` | Start MCP server for AI integration | [mcp.md](docs/cli/mcp.md) |
| `quick delete <sitename>` | Delete a deployed site | [delete.md](docs/cli/delete.md) |

### Deployment

```bash
quick deploy dist my-app        # deploy dist/ to my-app.quick.shopify.io
quick deploy . my-app --watch   # watch mode
quick serve                     # local dev at http://<dir>.quick.localhost:1337
```

Only deploy output files (e.g., `dist/`). Never bypass deployment confirmation prompts.

### Team Collaboration

For team projects, put your site in a GitHub repo and use the [CI/CD actions](docs/recipes/ci.md) to auto-deploy on merge. PRs get preview environments that clean up automatically. This is the recommended way to collaborate on a Quick site.

## Recipes

Extended guides for specific patterns and integrations. Read as needed:

- [Widgets](docs/recipes/widgets.md) — reusable UI components, embeddable bundles
- [200.html](docs/recipes/200-html.md) — SPA routing with catch-all fallback
- [Static Data](docs/recipes/static-data.md) — directory.json, users.json, usage data
- [HTTP MCP](docs/recipes/http-mcp.md) — browser agents + MCP tool access
- [Slack API](docs/recipes/slack-api.md) — Slack bots, OAuth, interactive messages
- [GitHub API](docs/recipes/github-api.md) — GitHub OAuth, repo/PR tools
- [Google Workspace](docs/recipes/gworkspace.md) — Sheets, Drive, Calendar
- [Image Generation](docs/recipes/image-generation.md) — fal.ai, DALL-E, visual content
- [Vite](docs/recipes/vite.md) — Vite dev server, build tooling, framework integration
- [CI/CD](docs/recipes/ci.md) — GitHub Actions deploy-to-quick / delete-from-quick
