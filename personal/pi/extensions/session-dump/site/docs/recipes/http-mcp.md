# HTTP MCP (Browser Agents + MCP)

Build AI agents in the browser that use tools via MCP. There are three patterns:

1. **Proxy MCP** — Connect to Shopify's internal MCP servers through Quick's AI proxy
2. **In-browser MCP** — Implement MCP tools as JavaScript functions (no server needed)

Both work with the OpenAI Agents SDK to give agents tool access.

## Proxy MCP Servers

Connect to Shopify MCP servers (Vault, Data Portal, etc.) through Quick's AI endpoint at `/api/ai/mcp/<server_name>`.

```html
<script src="https://quick.shopify.io/QuickMCPServerStreamableHttp.js"></script>

<script type="module">
import OpenAI from "https://cdn.jsdelivr.net/npm/openai/+esm";
import { Agent, run, setDefaultOpenAIClient } from "https://cdn.jsdelivr.net/npm/@openai/agents/+esm";

const client = new OpenAI({
  baseURL: `${window.location.origin}/api/ai`,
  apiKey: "not-needed",
  dangerouslyAllowBrowser: true,
});
setDefaultOpenAIClient(client);

// Connect to a Shopify MCP server
const mcpServer = new QuickMCPServerStreamableHttp({
  url: `${window.location.origin}/api/ai/mcp/vault_set`,
  name: "vault_set",
});
await mcpServer.connect();

// Create agent with MCP tools
const agent = new Agent({
  name: "Assistant",
  model: "gpt-5.2",
  instructions: "You have access to Shopify's knowledge base",
  mcpServers: [mcpServer],
});

const result = await run(agent, "What is Shopify's vacation policy?", {
  stream: true,
});
for await (const event of result) {
  if (event.type === "raw_model_stream_event") {
    const content = event.data?.delta?.content || event.data?.delta;
    if (content) document.getElementById("output").textContent += content;
  }
}
await result.completed;
</script>
```

### Available Proxy MCP Servers

Use with `/api/ai/mcp/<name>`. Some common ones:

- `vault_set` — Shopify knowledge base
- `data_portal` — Data warehouse metadata
- `catalog` — Catalog model
- `observe-mcp` — Observability
- `scout` — Merchant feedback data

See [proxy.shopify.io/dashboard/mcp-servers](https://proxy.shopify.io/dashboard/mcp-servers) for the full list of available servers.

## In-Browser MCP Servers

Implement MCP tools entirely in JavaScript — no remote server, no infrastructure. Any function you can call from the browser can become a tool an agent can use.

This is powerful because it means you can wrap **any API** into an MCP server: GitHub, Slack, Google Workspace, a third-party REST API, your own internal service — anything with an HTTP endpoint becomes an agent tool in a few lines of JavaScript. See the pre-built examples below (GitHub, Slack, Google Workspace) for real implementations of this pattern.

Taken further, you can build an MCP server that controls the page itself — reading DOM state, manipulating UI, filling forms, navigating between views. This turns an agent into a cooperative user of your web application, able to interact with it programmatically through tools you define.

An in-browser MCP server implements this interface:

```javascript
class MyMCPServer {
  async connect() {}
  async listTools() {
    return [
      {
        name: "my_tool",
        description: "Does something useful",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
          },
        },
      },
    ];
  }
  async callTool(toolName, args) {
    // Do work, return results
    return [{ type: "text", text: "Result here" }];
  }
  async close() {}
}
```

Then plug it into an agent:

```javascript
const myServer = new MyMCPServer();
await myServer.connect();

const agent = new Agent({
  name: "Assistant",
  model: "gpt-5.2",
  instructions: "You can use my custom tools",
  mcpServers: [myServer],
});
```

### Pre-built In-Browser MCP Servers

These are available as hosted scripts you can load from Quick:

```html
<!-- GitHub tools (repos, PRs, issues, code search) -->
<script src="https://github-mcp.quick.shopify.io/github-mcp.js"></script>

<!-- Google Workspace (Drive, Calendar, Mail) -->
<script src="https://apis.google.com/js/api.js"></script>
<script src="https://gworkspace-mcp.quick.shopify.io/gworkspace-mcp.js"></script>

<!-- Slack (channels, messages, search) -->
<script src="https://slack-mcp.quick.shopify.io/slack-mcp.js"></script>
```

Each handles OAuth automatically via `quick.auth`.

## Multiple MCP Servers

Agents can use multiple MCP servers simultaneously:

```javascript
const vault = new QuickMCPServerStreamableHttp({
  url: `${window.location.origin}/api/ai/mcp/vault_set`,
  name: "vault",
});
const github = new GitHubMCPServer();

await Promise.all([vault.connect(), github.connect()]);

const agent = new Agent({
  name: "Research Assistant",
  model: "gpt-5.2",
  instructions: "Use Vault for docs and GitHub for code",
  mcpServers: [vault, github],
});
```
