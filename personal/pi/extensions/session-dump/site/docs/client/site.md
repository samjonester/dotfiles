# Site Management (quick.site)

Create, inspect, and delete Quick sites programmatically.

## Include

```html
<script src="/client/quick.js"></script>
```

## Create a Site

```javascript
const html = `<!DOCTYPE html><html><body><h1>Hello</h1></body></html>`;
const file = new File([new Blob([html])], "index.html");

const result = await quick.site.create("my-site", [file]);
// => { message: "Site created successfully", url: "https://my-site.quick.shopify.io" }

// Force overwrite existing
await quick.site.create("my-site", files, { force: true });
```

## Get Site Info

```javascript
const info = await quick.site.get("my-site");
// => { subdomain: "my-site", url: "...", lastModified: "...", modified-by: "..." }
// Returns null if site doesn't exist
```

## Delete a Site

```javascript
// With confirmation prompt
await quick.site.delete("my-site");

// Skip confirmation
await quick.site.delete("my-site", { confirm: true });
```

## Quick Reference

| Method | Description |
|---|---|
| `create(subdomain, files, options?)` | Deploy files to a subdomain |
| `get(subdomain)` | Get site info (null if missing) |
| `delete(subdomain, options?)` | Delete site (prompts unless `confirm: true`) |
