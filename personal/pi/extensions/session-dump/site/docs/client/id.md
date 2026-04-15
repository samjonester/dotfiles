# User Identity (quick.id)

Access the current user's identity. Auto-loads on page load via IAP (Google Identity-Aware Proxy). All Shopify employee info is available.

## Include

```html
<script src="/client/quick.js"></script>
```

## Get User

```javascript
// Async (waits for load if needed)
const user = await quick.id.waitForUser();
// => { email, firstName, fullName, slackHandle, slackId, slackImageUrl, title, github, group, team, discipline, ... }

// Sync (returns null if not loaded yet)
const user = quick.id.getUser();
```

## Direct Property Access

```javascript
quick.id.email;          // "alex@shopify.com"
quick.id.fullName;       // "Alex Smith"
quick.id.firstName;      // "Alex"
quick.id.slackHandle;    // "alex.smith"
quick.id.slackId;        // "U012ABC3DEF"
quick.id.slackImageUrl;  // "https://..."
quick.id.title;          // "Senior Developer"
quick.id.github;         // "alexsmith"
quick.id.group;          // "Engineering"
quick.id.team;           // "Platform"
quick.id.discipline;     // "Development"
```

## Convenience Helpers

```javascript
quick.id.displayName;     // Best available name
quick.id.initials;        // "AS"
quick.id.domain;          // "shopify.com"
quick.id.isAuthenticated; // true (false if fallback/offline)
quick.id.isFromDomain("shopify.com"); // true
quick.id.format("{fullName} ({email})"); // "Alex Smith (alex@shopify.com)"
```

## Subscribe to Changes

```javascript
const unsubscribe = quick.id.subscribe((user) => {
  updateAvatar(user.slackImageUrl);
});
```

## Refresh

```javascript
await quick.id.refresh(); // Force re-fetch from server
```

## Quick Reference

| Property/Method | Description |
|---|---|
| `waitForUser()` | Async get user (waits for load) |
| `getUser()` | Sync get user (null if loading) |
| `email`, `fullName`, `firstName` | Basic identity |
| `slackHandle`, `slackId`, `slackImageUrl` | Slack info |
| `title`, `github`, `group`, `team`, `discipline` | Org info |
| `displayName` | Best available display name |
| `initials` | Two-letter initials |
| `isAuthenticated` | True if real user |
| `subscribe(callback)` | Listen to user changes |
| `refresh()` | Force re-fetch |
