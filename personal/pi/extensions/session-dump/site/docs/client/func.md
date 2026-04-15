# Cloud Functions (quick.func)

Invoke Google Cloud Functions and Cloud Run services from the browser. Requests are proxied through Quick with IAP authentication handled automatically.

## Include

```html
<script src="/client/quick.js"></script>
```

## Usage

```javascript
// Call a Cloud Function
const response = await quick.func.post(
  "https://us-central1-project.cloudfunctions.net/my-function",
  { body: { input: "data" } }
);
const result = await response.json();

// Call a Cloud Run service
const response = await quick.func.get(
  "https://my-service-abc123.a.run.app/status"
);
const data = await response.json();
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

### Options

| Field | Description |
|---|---|
| `headers` | Object of request headers |
| `body` | Request body (auto-serialized to JSON) |
