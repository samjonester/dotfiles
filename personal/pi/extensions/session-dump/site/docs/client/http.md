# HTTP Proxy (quick.http)

Make requests to external APIs from the browser, proxied through Quick's server. Bypasses CORS restrictions.

## Include

```html
<script src="/client/quick.js"></script>
```

## Usage

```javascript
// GET
const response = await quick.http.get("https://api.example.com/data");
const data = await response.json();

// POST
const response = await quick.http.post("https://api.example.com/items", {
  headers: { "Authorization": "Bearer token123" },
  body: { name: "Widget", price: 9.99 },
});
const result = await response.json();
```

All standard HTTP methods are supported. Each returns a standard `Response` object.

## Quick Reference

| Method | Description |
|---|---|
| `get(url, options?)` | GET request |
| `post(url, options?)` | POST request |
| `put(url, options?)` | PUT request |
| `patch(url, options?)` | PATCH request |
| `delete(url, options?)` | DELETE request |
| `head(url, options?)` | HEAD request |
| `options(url, options?)` | OPTIONS request |

### Options

| Field | Description |
|---|---|
| `headers` | Object of request headers |
| `body` | Request body (auto-serialized to JSON) |
