---
summary: Dump and load Pi sessions via pi-dump.quick.shopify.io.
commands: [/session-dump, /session-load]
category: productivity
keywords: [session, dump, load, quick, share]
---

# Session Dump

Dump sessions to [pi-dump.quick.shopify.io](https://pi-dump.quick.shopify.io) and load them back by UUID.

## Commands

| Command | Description |
|---------|-------------|
| `/session-dump` | Upload current session, get a UUID |
| `/session-load <uuid>` | Download a dump and save locally (use `/resume` to switch) |
| `/session-load` | Pick from your recent dumps |

## Setup

```bash
npm install -g @shopify/quick
quick auth
```
