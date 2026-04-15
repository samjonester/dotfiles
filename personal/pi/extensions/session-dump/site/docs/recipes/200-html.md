# SPA Routing with 200.html

Quick supports single-page application routing via `200.html`. When a request comes in for a path that doesn't match a static file, Quick serves `200.html` instead of returning 404. This lets your client-side router (React Router, Vue Router, Preact Router, etc.) handle the URL.

## How It Works

1. Request comes in for `/dashboard/settings`
2. Quick looks for a static file at that path — not found
3. Quick checks if `200.html` exists in the site root
4. If yes, serves `200.html` with a 200 status — your JS router takes over
5. If no, returns 404

Both production (nginx `try_files $uri $uri/ /200.html =404`) and `quick serve` implement this identically.

## Setup

Add a post-build step that copies (or moves) `index.html` to `200.html`:

```json
{
  "scripts": {
    "build": "vite build && cp dist/index.html dist/200.html"
  }
}
```

That's it. Deploy `dist/` as usual.

### Copy vs Move

- **`cp`** (recommended): Keeps both files. `/` loads `index.html`, unknown routes fall back to `200.html`. Both are the same file.
- **`mv`**: Only `200.html` exists. Works fine because Quick's `index` directive includes `200.html`, so `/` still resolves. But having both is safer and clearer.

## When to Use

Use `200.html` any time your app has client-side routing:

- React with React Router
- Vue with Vue Router
- Preact with preact-router or preact-iso
- Svelte with SvelteKit (static adapter)
- Any hash-free SPA routing (`/path` instead of `/#/path`)

You do **not** need `200.html` if your app only uses hash routing (`/#/page`) or has no routing at all.
