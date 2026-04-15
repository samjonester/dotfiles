# Slack (quick.slack)

Send messages to Slack channels and users. Supports plain text, blocks, alerts, tables, and code snippets.

## Include

```html
<script src="/client/quick.js"></script>
```

## Send a Message

```javascript
// Simple text
await quick.slack.sendMessage("W02AJD7R7LQ", "Hello team!");

// With blocks
await quick.slack.sendMessage("W02AJD7R7LQ", "Deploy complete", {
  blocks: [
    { type: "section", text: { type: "mrkdwn", text: "*Deploy complete*" } },
  ],
});

// Thread reply
const msg = await quick.slack.sendMessage("W02AJD7R7LQ", "Original");
await quick.slack.sendMessage("W02AJD7R7LQ", "Reply", {
  thread_ts: msg.slack_response.ts,
});
```

## Alerts

```javascript
await quick.slack.sendAlert("W02AJD7R7LQ", "CPU spike detected", "warning");
// Levels: "info", "warning", "error", "success"
```

## Status Updates

```javascript
await quick.slack.sendStatus("W02AJD7R7LQ", "online", "All systems go");
// Statuses: "online", "offline", "maintenance", "degraded"
```

## Code Snippets

```javascript
await quick.slack.sendCode("#dev", 'console.log("hi")', "javascript", "Example");
```

## Tables

```javascript
await quick.slack.sendTable(
  "#reports",
  "Sales Report",
  ["Product", "Sales"],
  [
    ["Widget", 100],
    ["Gadget", 200],
  ]
);
```

## Block Builder

Fluent helper for constructing Slack blocks:

```javascript
const blocks = quick.slack.createBlocks()
  .header("Deploy Report")
  .section("*Environment:* Production")
  .fields([
    { title: "Status", value: "Success" },
    { title: "Duration", value: "2m 30s" },
  ])
  .divider()
  .section("All checks passed.")
  .build();

await quick.slack.sendMessage("W02AJD7R7LQ", "Deploy Report", { blocks });
```

## Utilities

```javascript
quick.slack.formatMention("U012ABC");     // => "<@U012ABC>"
quick.slack.formatChannel("C012ABC");     // => "<#C012ABC>"
quick.slack.escapeText("<script>alert"); // => "&lt;script&gt;alert"
```

## Quick Reference

| Method | Description |
|---|---|
| `sendMessage(channel, text, options?)` | Send message |
| `sendAlert(channel, message, level)` | Alert (info/warning/error/success) |
| `sendStatus(channel, status, details)` | Status (online/offline/maintenance/degraded) |
| `sendCode(channel, code, lang, title)` | Code snippet |
| `sendTable(channel, title, headers, rows)` | Formatted table |
| `sendNotification(channel, title, msg)` | Rich notification |
| `createBlocks()` | Block builder |
| `health()` | Check Slack integration health |
| `formatMention(userId)` | Format user mention |
| `formatChannel(channelId)` | Format channel link |
