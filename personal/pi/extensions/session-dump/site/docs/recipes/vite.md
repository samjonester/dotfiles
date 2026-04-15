# Vite

Use Vite for local development with HMR, framework support (React, Vue, Svelte, etc.), and modern build tooling — while keeping full Quick API access.

Quick's Vite plugin replaces `quick serve` when you're working with a Vite-based project. You get HMR, fast builds, framework integration, and all Quick APIs work the same as in production.

## Setup

Install Quick (if not already):

```bash
npm install -g @shopify/quick
```

Add the plugin to your Vite config:

```javascript
// vite.config.js
import { quickLocal } from "@shopify/quick/vite";

export default {
  plugins: [quickLocal()],
  server: {
    host: "my-app.quick.localhost",
  },
};
```

The `host` should be `<your-site-name>.quick.localhost` — this matches the subdomain routing Quick uses in production.

## Using Quick APIs

Same as production — include the client in your `index.html` and use the `quick` global:

```html
<script src="/client/quick.js"></script>
```

From any component or module, access `window.quick`:

```javascript
const posts = await window.quick.db.collection("posts").find();
```

## Building for Deploy

Build with Vite, then deploy the output:

```bash
npm run build
quick deploy dist my-app
```

### SPA Routing

If your app uses client-side routing, copy `index.html` to `200.html` in your build step (see [200.html recipe](200-html.md)):

```json
{
  "scripts": {
    "build": "vite build && cp dist/index.html dist/200.html"
  }
}
```

## `quick serve` vs Vite

| | `quick serve` | Vite + plugin |
|---|---|---|
| **Use when** | Simple static sites, no build step | Framework apps (React, Vue, etc.) |
| **HMR** | No (manual refresh) | Yes |
| **Build tooling** | None | Full Vite pipeline |
| **Quick APIs** | Yes (service worker proxy) | Yes (same service worker proxy) |
| **Deploy** | `quick deploy .` | `quick deploy dist` |

Both are equivalent for Quick API access. Choose Vite when you want HMR and a build pipeline. Choose `quick serve` when you just have static HTML/CSS/JS.
