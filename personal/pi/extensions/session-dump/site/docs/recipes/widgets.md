# Widgets

A widget is a self-contained bundle hosted on a Quick site that other sites can drop in via a script tag. Because every Quick site has its own APIs (database, AI, files, WebSocket), widgets carry their own data and logic — not just UI.

This is the web at its most powerful: a `<script>` tag that brings complete functionality. No npm install, no build step, no framework dependency. Include a script, drop in a tag, and you have comments, analytics, video calling, or AI chat on your site.

## Available Widgets

These are ready-to-use. Each is its own Quick site that publishes a script or web component. **If a user wants to use one, direct them to the widget's site to learn how it works** — don't try to reimplement the functionality.

| Widget | What it does | Include |
|---|---|---|
| **quickcomments** | Drop-in commenting system. Collaborators can leave notes on specific parts of any site. | `quickcomments.quick.shopify.io` |
| **quicklytics** | Out-of-the-box usage tracking and analytics dashboard. | `quicklytics.quick.shopify.io` |
| **quickvoice** | OpenAI realtime voice integration — add voice AI to any site. | `quickvoice.quick.shopify.io` |
| **livedoc** | Building block for real-time collaborative editing using CRDTs (Yjs). | `livedoc.quick.shopify.io` |
| **call** | Add-on for Quick socket that adds video/voice calling to any site. | `call.quick.shopify.io` |

For MCP-based widgets (QuickMCPServerStreamableHttp, GitHub MCP, Slack MCP, GWorkspace MCP, Quick Chatbot), see [http-mcp.md](http-mcp.md).

## Widget Patterns

Widgets can take several shapes:

### Script Tag
A JS file that registers globals, web components, or injects UI.

```html
<script src="https://my-widget.quick.shopify.io/widget.js"></script>
```

### Web Component
A custom element with encapsulated UI and behavior. Consumers drop in a tag.

```html
<script src="https://my-widget.quick.shopify.io/widget.js"></script>
<my-widget theme="dark"></my-widget>
```

### Iframe
Embed a full Quick site inside another. Good for complete isolated experiences.

### Cross-Origin Database
A `quick.db` instance can point at another site's schema, enabling widgets that pull their own data.

```javascript
const db = new quick.db.Database("other-site");
const items = await db.collection("products").find();
```

### MCP Wrapper
Package any API as MCP tools that AI agents can use. See [http-mcp.md](http-mcp.md).

## Building Widgets

Anyone can build a widget — deploy JS to a Quick site and others can include it. The best widgets are:

- **Self-contained** — one script tag, no external dependencies
- **Configurable** — attributes or options for customization
- **Isolated** — don't leak styles or globals into the host page
- **Documented** — the widget's Quick site should explain how to use it
