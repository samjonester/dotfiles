# quick mcp

Start an MCP (Model Context Protocol) server that connects AI assistants to a Quick site. Runs as a JSON-RPC stdio proxy with IAP authentication.

## Usage

```bash
quick mcp [site_name]
quick mcp                           # connects to quick.shopify.io
quick mcp my-site                   # connects to my-site.quick.shopify.io
quick mcp http://localhost:3000/api/mcp  # custom URL (dev/testing)
```

## Prerequisites

Run `quick auth` first to set up OAuth credentials.

## Configuring AI Clients

### Cursor

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "my-site": {
      "command": "quick",
      "args": ["mcp", "my-site"]
    }
  }
}
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "my-site": {
      "command": "quick",
      "args": ["mcp", "my-site"]
    }
  }
}
```

Restart the AI client after adding the config.

## How It Works

1. Reads JSON-RPC requests from stdin
2. Gets/caches IAP tokens using OAuth credentials from `quick auth`
3. Forwards requests to `https://<site>.quick.shopify.io/api/mcp`
4. Writes JSON-RPC responses to stdout

Tokens are cached for 55 minutes (IAP tokens valid for 1 hour).

## What AI Can Do

Once connected, the AI assistant can:

- **Search** site content (full-text, vector, hybrid)
- **Query** the site's database collections (read-only)
- **Read** files from the site directory
- **Use prompts** defined in the site's `prompts/` directory
- **Follow instructions** from the site's `instructions.txt`
