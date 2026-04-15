# Slack API

Access Slack's Web API from Quick sites via user-scoped OAuth tokens. This is different from `quick.slack` (which uses the platform bot token) — here you get a **user token** to call any Slack API method as the authenticated user.

Note: Quick also has a built-in `quick.slack.sendMessage()` for simple bot-level messaging (see [client/slack.md](../client/slack.md)). Use this recipe when you need user-scoped access (search, DMs, user info, etc.).

## Authenticate

```javascript
const token = await quick.auth.slack.getToken([
  "channels:read",
  "chat:write",
  "users:read",
]);
// => { access_token, user_id, team_id, team_name, scopes }
```

## Make API Calls

Slack's API doesn't support browser CORS, so use `quick.http` to proxy requests. Some methods use GET (with query params) and others use POST (with form-encoded body).

**GET example** — `users.info`:

```javascript
const response = await quick.http.get(
  `https://slack.com/api/users.info?user=${token.user_id}`,
  {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
    },
  }
);
const data = await response.json();
```

**POST example** — `chat.postMessage`:

```javascript
const response = await quick.http.post("https://slack.com/api/chat.postMessage", {
  headers: {
    Authorization: `Bearer ${token.access_token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ channel: "C012ABC", text: "Hello!" }),
});
const data = await response.json();
```

## Common Methods

| Method | HTTP | Description | Scopes |
|---|---|---|---|
| `conversations.list` | GET | List channels | `channels:read`, `groups:read` |
| `conversations.history` | GET | Channel messages | `channels:history` |
| `conversations.replies` | GET | Thread replies | `channels:history` |
| `chat.postMessage` | POST | Send message | `chat:write` |
| `users.list` | GET | List users | `users:read` |
| `users.info` | GET | User details | `users:read` |
| `search.messages` | GET | Search messages | `search:read` |
| `search.files` | GET | Search files | `search:read` |
| `files.list` | GET | List files | `files:read` |
| `reactions.add` | POST | Add reaction | `reactions:write` |

## Check Status / Revoke

```javascript
const status = await quick.auth.slack.checkStatus(["channels:read"]);
await quick.auth.slack.revoke();
```
