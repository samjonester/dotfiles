> Made @ Shopify

# pi-figma-remote-mcp

Connects [pi-coding-agent](https://github.com/badlogic/pi-mono) to the Figma remote MCP server.

Uses OAuth2 to authenticate with `https://mcp.figma.com/mcp`. No Figma desktop app required — works with browser-based Figma.

## When to use this vs pi-figma-mcp

| | pi-figma-mcp (desktop) | pi-figma-remote-mcp |
|---|---|---|
| Requires desktop app | Yes | No |
| Auth | None | OAuth2 |
| `generate_figma_design` | No | Yes |
| `create_new_file` | No | Yes |
| `use_figma` writes | No (use figma-labor bridge) | Yes |

Use the desktop extension (`pi-figma-mcp`) for day-to-day work with the bridge.
Use this extension when you need remote-only features or don't have the desktop app.

## Install

Message `pi`:

```
Install this pi-extension https://github.com/mkaralevich/pi-figma-remote-mcp
```

Or place extension in your `/extensions` folder.

## Use

1. Run `/figma-remote-auth` to authenticate (opens browser for Figma OAuth)
2. Footer shows `figma-remote ✓` when connected
3. Give pi a link to a frame

Token is saved to `~/.pi/figma-remote-mcp-token.json` and auto-refreshes.

> **Note:** Figma's dynamic client registration endpoint is whitelisted by `client_name`. This extension registers as `"Claude Code"` to pass registration. Custom names get 403 Forbidden.

## Commands

| Command | Description |
|---|---|
| `/figma-remote` | Show connection status and available tools |
| `/figma-remote-auth` | Run OAuth authentication |
