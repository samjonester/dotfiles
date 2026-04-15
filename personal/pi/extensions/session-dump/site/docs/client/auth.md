# Auth (quick.auth)

OAuth management for Google, GitHub, and Slack. Handles scope checking, authorization flows (popup-based), and token retrieval.

## Include

```html
<script src="/client/quick.js"></script>
```

## Google OAuth

Used for BigQuery, Google Sheets, Drive, etc.

```javascript
// Check if user has required scopes
const status = await quick.auth.checkStatus([
  "https://www.googleapis.com/auth/bigquery",
]);
// => { hasRequiredScopes: true/false, ... }

// Request scopes (shows auth bar if needed)
const result = await quick.auth.requestScopes([
  "https://www.googleapis.com/auth/bigquery",
]);

// Get access token (opens popup if not yet authorized)
const token = await quick.auth.getToken([
  "https://www.googleapis.com/auth/spreadsheets.readonly",
]);
// => { access_token, expires_in, scopes, token_type }

// Use with Google APIs via quick.http (token stays server-side)
const response = await quick.http.get(
  `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/A1:D10`,
  { headers: { Authorization: `Bearer ${token.access_token}` } }
);

// Revoke authorization
await quick.auth.revoke();
```

## GitHub OAuth

```javascript
// Check status
const status = await quick.auth.github.checkStatus(["repo", "user"]);

// Get token (opens popup if needed)
const token = await quick.auth.github.getToken(["repo", "user"]);
// => { access_token, scope, token_type }

// Revoke
await quick.auth.github.revoke();
```

## Slack OAuth

```javascript
// Check status
const status = await quick.auth.slack.checkStatus(["chat:write", "users:read"]);

// Get token (opens popup if needed)
const token = await quick.auth.slack.getToken(["chat:write", "users:read"]);
// => { access_token, scope, scopes, user_id, team_id, team_name }

// Revoke
await quick.auth.slack.revoke();
```

## Quick Reference

### Google

| Method | Description |
|---|---|
| `checkStatus(scopes)` | Check if scopes are authorized |
| `requestScopes(scopes)` | Request scopes (shows auth bar) |
| `getToken(scopes)` | Get access token (popup if needed) |
| `revoke()` | Revoke Google authorization |

### GitHub

| Method | Description |
|---|---|
| `github.checkStatus(scopes)` | Check GitHub auth status |
| `github.getToken(scopes)` | Get GitHub token (popup if needed) |
| `github.revoke()` | Revoke GitHub authorization |

### Slack

| Method | Description |
|---|---|
| `slack.checkStatus(scopes)` | Check Slack auth status |
| `slack.getToken(scopes)` | Get Slack token (popup if needed) |
| `slack.revoke()` | Revoke Slack authorization |
