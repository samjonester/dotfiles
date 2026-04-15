# AI (quick.ai)

Quick's AI endpoint (`/api/ai`) is an OpenAI-compatible proxy through Shopify's LLM proxy. It handles authentication and CORS so you can use the OpenAI SDK directly from the browser with no API key needed.

## Include

```html
<script src="/client/quick.js"></script>
```

## OpenAI SDK (Recommended)

Point the standard OpenAI SDK at Quick's endpoint. This gives you the full SDK surface -- chat, streaming, tool use, structured outputs, images, everything.

```javascript
import OpenAI from "https://cdn.jsdelivr.net/npm/openai/+esm";

const client = new OpenAI({
  baseURL: `/api/ai`,
  apiKey: "not-needed",
  dangerouslyAllowBrowser: true,
});
```

### Chat

```javascript
const response = await client.chat.completions.create({
  model: "gpt-5.2",
  messages: [
    { role: "system", content: "You are a helpful assistant" },
    { role: "user", content: "Explain closures in JS" },
  ],
});
console.log(response.choices[0].message.content);
```

### Streaming

```javascript
const stream = await client.chat.completions.create({
  model: "gpt-5.2",
  messages: [{ role: "user", content: "Write a haiku about code" }],
  stream: true,
});

let output = "";
for await (const chunk of stream) {
  const content = chunk.choices[0]?.delta?.content;
  if (content) {
    output += content;
    document.getElementById("output").textContent = output;
  }
}
```

## Agents SDK

For agentic flows with tool use and MCP integration:

```javascript
import OpenAI from "https://cdn.jsdelivr.net/npm/openai/+esm";
import { Agent, run, setDefaultOpenAIClient } from "https://cdn.jsdelivr.net/npm/@openai/agents/+esm";

const client = new OpenAI({
  baseURL: `${window.location.origin}/api/ai`,
  apiKey: "not-needed",
  dangerouslyAllowBrowser: true,
});
setDefaultOpenAIClient(client);

const agent = new Agent({
  name: "Assistant",
  model: "gpt-5.2",
  instructions: "You are a helpful assistant",
});

const result = await run(agent, "Explain quantum computing", { stream: true });
for await (const event of result) {
  if (event.type === "raw_model_stream_event") {
    const content = event.data?.delta?.content || event.data?.delta;
    if (content) document.getElementById("output").textContent += content;
  }
}
await result.completed;
```

### With MCP Tools

```html
<script src="https://quick.shopify.io/QuickMCPServerStreamableHttp.js"></script>
<script type="module">
import { Agent, run } from "https://cdn.jsdelivr.net/npm/@openai/agents/+esm";

const mcpServer = new QuickMCPServerStreamableHttp({
  url: `${window.location.origin}/api/ai/mcp/vault_set`,
  name: "vault_set",
});
await mcpServer.connect();

const agent = new Agent({
  name: "Assistant",
  model: "gpt-5.2",
  instructions: "You are a helpful assistant with database access",
  mcpServers: [mcpServer],
});

const result = await run(agent, "What is Shopify's vacation policy?", { stream: true });
// ... handle streaming events
</script>
```

## Realtime API

```javascript
const token = await quick.ai.getRealtimeToken({
  session: {
    type: "realtime",
    model: "gpt-realtime",
    audio: { output: { voice: "marin" } },
  },
});
```

## Convenience Methods

Simple helpers for quick prototyping or console use. For anything substantial, use the OpenAI SDK above.

```javascript
// One-shot question
const answer = await quick.ai.ask("What is the capital of France?");

// With system prompt
const answer = await quick.ai.askWithSystem("Be concise", "Explain closures");

// Streaming one-liner
await quick.ai.askStream("Write a poem", (chunk, full) => {
  document.getElementById("output").textContent = full;
});
```

## How It Works

The `/api/ai` endpoint is a transparent proxy to Shopify's LLM proxy (`proxy.shopify.ai`). It adds authentication headers and handles CORS -- nothing else. Any OpenAI-compatible request works. There are no custom server-side transformations.

## Quick Reference

| Approach | When to Use |
|---|---|
| **OpenAI SDK** | Recommended for all real usage |
| **Agents SDK** | Agentic flows, tool use, MCP |
| `ask(question)` | Quick console test |
| `askWithSystem(system, msg)` | Quick console test with system prompt |
| `askStream(question, onChunk)` | Quick streaming test |
| `getRealtimeToken(config)` | Realtime API token |
