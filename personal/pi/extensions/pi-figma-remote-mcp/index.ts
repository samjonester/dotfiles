/**
 * pi-figma-remote-mcp — pi extension
 *
 * Connects pi to the Figma remote MCP server (https://mcp.figma.com/mcp).
 * Requires OAuth2 authentication. Provides full feature set including
 * use_figma, generate_figma_design, create_new_file, and search_design_system.
 *
 * Use this when you need remote-only features or don't have the Figma desktop app.
 * For desktop-based workflows, use pi-figma-mcp instead.
 *
 * Tools are discovered dynamically from the server on session start.
 * Commands:
 *   /figma-remote       — show connection status and available tools
 *   /figma-remote-auth  — run OAuth authentication
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type, type TSchema } from "@sinclair/typebox";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createServer, type Server } from "node:http";
import { randomBytes, createHash } from "node:crypto";

// ## Config

const MCP_URL = "https://mcp.figma.com/mcp";
const MAX_OUTPUT_BYTES = 50 * 1024;
const TOKEN_PATH = join(homedir(), ".pi", "figma-remote-mcp-token.json");

const OAUTH_AUTHORIZATION_URL = "https://www.figma.com/oauth/mcp";
const OAUTH_TOKEN_URL = "https://api.figma.com/v1/oauth/token";
const OAUTH_CALLBACK_PORT = 9876;
const OAUTH_REDIRECT_URI = `http://localhost:${OAUTH_CALLBACK_PORT}/callback`;
const OAUTH_REGISTRATION_URL = "https://api.figma.com/v1/oauth/mcp/register";

// ## State

let sessionId: string | undefined;
let requestId = 1;
let connected = false;
let availableTools: Array<{ name: string; description: string }> = [];
let accessToken: string | undefined;
let refreshToken: string | undefined;
let clientId: string | undefined;
let clientSecret: string | undefined;
let tokenExpiresAt = 0;

// ## Token persistence

interface TokenData {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  clientId?: string;
  clientSecret?: string;
}

function loadToken(): boolean {
  try {
    if (!existsSync(TOKEN_PATH)) return false;
    const data: TokenData = JSON.parse(readFileSync(TOKEN_PATH, "utf8"));
    accessToken = data.accessToken;
    refreshToken = data.refreshToken;
    tokenExpiresAt = data.expiresAt ?? 0;
    clientId = data.clientId;
    clientSecret = data.clientSecret;
    return !!accessToken;
  } catch {
    return false;
  }
}

function saveToken(): void {
  try {
    mkdirSync(join(homedir(), ".pi"), { recursive: true });
    const data: TokenData = {
      accessToken: accessToken!,
      refreshToken,
      expiresAt: tokenExpiresAt,
      clientId,
      clientSecret,
    };
    writeFileSync(TOKEN_PATH, JSON.stringify(data, null, 2), "utf8");
  } catch {
    // Non-fatal
  }
}

// ## PKCE helpers

function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

// ## OAuth 2.0 dynamic client registration + PKCE

async function registerOAuthClient(): Promise<{
  clientId: string;
  clientSecret: string;
}> {
  const res = await fetch(OAUTH_REGISTRATION_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Claude Code",
      redirect_uris: [OAUTH_REDIRECT_URI],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "mcp:connect",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Client registration failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as {
    client_id: string;
    client_secret?: string;
  };
  return { clientId: data.client_id, clientSecret: data.client_secret ?? "" };
}

async function waitForAuthCode(
  state: string
): Promise<{ code: string; state: string }> {
  return new Promise((resolve, reject) => {
    let server: Server;
    const timeout = setTimeout(() => {
      server?.close();
      reject(new Error("OAuth timeout — no callback received within 120s"));
    }, 120_000);

    server = createServer((req, res) => {
      const url = new URL(
        req.url!,
        `http://localhost:${OAUTH_CALLBACK_PORT}`
      );
      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end();
        return;
      }

      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          `<html><body><h2>Authentication failed</h2><p>${error}</p><p>You can close this tab.</p></body></html>`
        );
        clearTimeout(timeout);
        server.close();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }

      if (!code || returnedState !== state) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(
          `<html><body><h2>Invalid callback</h2><p>You can close this tab.</p></body></html>`
        );
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        `<html><body><h2>Authenticated with Figma ✓</h2><p>You can close this tab and return to pi.</p></body></html>`
      );
      clearTimeout(timeout);
      server.close();
      resolve({ code, state: returnedState });
    });

    server.listen(OAUTH_CALLBACK_PORT, () => {});
    server.on("error", (err) => {
      clearTimeout(timeout);
      reject(
        new Error(
          `Could not start OAuth callback server on port ${OAUTH_CALLBACK_PORT}: ${err.message}`
        )
      );
    });
  });
}

async function exchangeCodeForToken(
  code: string,
  codeVerifier: string
): Promise<void> {
  const params: Record<string, string> = {
    client_id: clientId!,
    redirect_uri: OAUTH_REDIRECT_URI,
    code,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
  };
  if (clientSecret) params.client_secret = clientSecret;

  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  accessToken = data.access_token;
  refreshToken = data.refresh_token;
  tokenExpiresAt = data.expires_in
    ? Date.now() + data.expires_in * 1000
    : 0;
  saveToken();
}

async function refreshAccessToken(): Promise<boolean> {
  if (!refreshToken || !clientId) return false;

  try {
    const res = await fetch(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret ?? "",
      }).toString(),
    });

    if (!res.ok) return false;

    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    accessToken = data.access_token;
    if (data.refresh_token) refreshToken = data.refresh_token;
    tokenExpiresAt = data.expires_in
      ? Date.now() + data.expires_in * 1000
      : 0;
    saveToken();
    return true;
  } catch {
    return false;
  }
}

async function runFullOAuthFlow(ctx: {
  ui: { notify: (msg: string, level: string) => void };
}): Promise<boolean> {
  ctx.ui.notify("Registering with Figma MCP server...", "info");
  const reg = await registerOAuthClient();
  clientId = reg.clientId;
  clientSecret = reg.clientSecret;

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = randomBytes(16).toString("hex");

  const authUrl = new URL(OAUTH_AUTHORIZATION_URL);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", OAUTH_REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "mcp:connect");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  ctx.ui.notify(
    `Opening browser for Figma authentication...\n\nIf the browser doesn't open, visit:\n${authUrl.toString()}`,
    "info"
  );

  const { exec } = await import("node:child_process");
  exec(`open "${authUrl.toString()}"`);

  const { code } = await waitForAuthCode(state);
  await exchangeCodeForToken(code, codeVerifier);

  return true;
}

// ## MCP HTTP client

async function mcpPost(
  method: string,
  params?: Record<string, unknown>,
  signal?: AbortSignal
): Promise<unknown> {
  if (tokenExpiresAt > 0 && Date.now() > tokenExpiresAt - 60_000) {
    await refreshAccessToken();
  }

  const id = requestId++;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;

  const response = await fetch(MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    signal,
  });

  const newSid = response.headers.get("mcp-session-id");
  if (newSid) sessionId = newSid;

  if (!response.ok) {
    if (response.status === 401) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        const retryHeaders = {
          ...headers,
          Authorization: `Bearer ${accessToken}`,
        };
        const retry = await fetch(MCP_URL, {
          method: "POST",
          headers: retryHeaders,
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: requestId++,
            method,
            params,
          }),
          signal,
        });
        const retrySid = retry.headers.get("mcp-session-id");
        if (retrySid) sessionId = retrySid;
        if (!retry.ok) throw new Error("AUTH_REQUIRED");

        const ct = retry.headers.get("content-type") ?? "";
        const txt = await retry.text();
        let j: { result?: unknown; error?: { message: string } };
        if (ct.includes("text/event-stream")) {
          const dl = txt.split("\n").find((l) => l.startsWith("data: "));
          if (!dl) throw new Error("No data in SSE response");
          j = JSON.parse(dl.slice(6));
        } else {
          j = JSON.parse(txt);
        }
        if (j.error) throw new Error(j.error.message);
        return j.result;
      }
      throw new Error("AUTH_REQUIRED");
    }
    throw new Error(`MCP HTTP ${response.status}: ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();

  let json: { result?: unknown; error?: { message: string } };

  if (contentType.includes("text/event-stream")) {
    const dataLine = text.split("\n").find((l) => l.startsWith("data: "));
    if (!dataLine) throw new Error("No data in SSE response");
    json = JSON.parse(dataLine.slice(6));
  } else {
    json = JSON.parse(text);
  }

  if (json.error) throw new Error(json.error.message);
  return json.result;
}

// ## Session

async function initializeSession(signal?: AbortSignal): Promise<boolean> {
  try {
    sessionId = undefined;
    await mcpPost(
      "initialize",
      {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "pi-figma-remote-mcp", version: "1.0" },
      },
      signal
    );
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "AUTH_REQUIRED") return false;
    throw err;
  }
}

// ## Tool discovery

interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties?: Record<
      string,
      {
        type: string;
        description?: string;
        enum?: string[];
        items?: unknown;
        default?: unknown;
      }
    >;
    required?: string[];
  };
}

interface McpContent {
  type: "text" | "image" | "resource";
  text?: string;
  data?: string;
  mimeType?: string;
  uri?: string;
}

interface McpToolResult {
  content: McpContent[];
  isError?: boolean;
}

async function listTools(signal?: AbortSignal): Promise<McpTool[]> {
  const result = (await mcpPost("tools/list", undefined, signal)) as {
    tools: McpTool[];
  };
  return result.tools ?? [];
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal
): Promise<McpToolResult> {
  return (await mcpPost(
    "tools/call",
    { name, arguments: args },
    signal
  )) as McpToolResult;
}

// ## Content conversion

function truncate(text: string): string {
  if (Buffer.byteLength(text, "utf8") <= MAX_OUTPUT_BYTES) return text;
  return (
    Buffer.from(text, "utf8").slice(0, MAX_OUTPUT_BYTES).toString("utf8") +
    "\n\n[Output truncated — use a more specific nodeId or break the design into smaller sections.]"
  );
}

function convertContent(
  mcpContent: McpContent[]
): Array<
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string }
> {
  const out: ReturnType<typeof convertContent> = [];
  for (const c of mcpContent) {
    if (c.type === "text" && c.text) {
      out.push({ type: "text", text: truncate(c.text) });
    } else if (c.type === "image" && c.data && c.mimeType) {
      out.push({ type: "image", mimeType: c.mimeType, data: c.data });
    } else if (c.type === "resource" && c.uri) {
      out.push({ type: "text", text: `[Resource: ${c.uri}]` });
    }
  }
  return out;
}

// ## Schema builder

function buildSchema(inputSchema: McpTool["inputSchema"]): TSchema {
  const props = inputSchema.properties ?? {};
  const required = new Set(inputSchema.required ?? []);
  const fields: Record<string, TSchema> = {};

  for (const [key, prop] of Object.entries(props)) {
    let schema: TSchema;

    if (prop.enum) {
      schema = Type.Union(prop.enum.map((v) => Type.Literal(v)));
    } else if (prop.type === "boolean") {
      schema = Type.Boolean();
    } else if (prop.type === "number" || prop.type === "integer") {
      schema = Type.Number();
    } else if (prop.type === "array") {
      schema = Type.Array(Type.Any());
    } else {
      schema = Type.String();
    }

    const description = prop.description ?? "";
    const withDesc = description ? { ...schema, description } : schema;
    fields[key] = required.has(key) ? withDesc : Type.Optional(withDesc);
  }

  return Type.Object(fields);
}

// ## Tool registration

function formatLabel(name: string): string {
  return name
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function registerMcpTools(pi: ExtensionAPI, tools: McpTool[]) {
  availableTools = tools.map((t) => ({
    name: t.name,
    description: t.description,
  }));

  for (const tool of tools) {
    const schema = buildSchema(tool.inputSchema);

    pi.registerTool({
      name: tool.name,
      label: formatLabel(tool.name),
      description: tool.description,
      parameters: schema,

      async execute(_id, params, signal) {
        if (!sessionId) {
          const ok = await initializeSession(signal);
          if (!ok) {
            return {
              content: [
                {
                  type: "text",
                  text: "Figma remote MCP session expired. Run /figma-remote-auth to re-authenticate.",
                },
              ],
              isError: true,
            };
          }
        }

        try {
          const result = await callTool(
            tool.name,
            params as Record<string, unknown>,
            signal
          );
          return {
            content: convertContent(result.content),
            isError: result.isError ?? false,
          };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg === "AUTH_REQUIRED") {
            accessToken = undefined;
            sessionId = undefined;
            return {
              content: [
                {
                  type: "text",
                  text: "Figma remote MCP authentication expired. Run /figma-remote-auth to re-authenticate.",
                },
              ],
              isError: true,
            };
          }
          if (msg.includes("404") || msg.includes("session"))
            sessionId = undefined;
          return {
            content: [
              { type: "text", text: `Figma remote MCP error: ${msg}` },
            ],
            isError: true,
          };
        }
      },
    });
  }
}

// ## Extension

export default function (pi: ExtensionAPI) {
  // ## Lifecycle

  pi.on("session_start", async (_event, ctx) => {
    (async () => {
      const signal = AbortSignal.timeout(10_000);
      try {
        if (!loadToken()) {
          connected = false;
          ctx.ui.setStatus("figma-remote", "figma-remote ○");
          return;
        }

        const ok = await initializeSession(signal);
        if (!ok) {
          connected = false;
          ctx.ui.setStatus("figma-remote", "figma-remote ✗");
          return;
        }

        const tools = await listTools(signal);
        connected = true;
        ctx.ui.setStatus("figma-remote", "figma-remote ✓");
        registerMcpTools(pi, tools);
      } catch {
        connected = false;
        ctx.ui.setStatus("figma-remote", "figma-remote ✗");
      }
    })();
  });

  // ## System prompt

  pi.on("before_agent_start", async (event) => {
    if (!connected) return;

    return {
      systemPrompt:
        event.systemPrompt +
        `

## Figma Remote MCP Server

You have a live connection to Figma via the remote MCP server.

The \`use_figma\` tool can **create, edit, and delete** content on the Figma canvas by executing Plugin API JavaScript. Use it for all canvas mutations. The \`search_design_system\` tool finds existing components and variables in connected libraries.

**nodeId format:** Use \`123:456\` or \`123-456\`. Extract from Figma URLs: \`?node-id=1-2\` → \`1:2\`. If no nodeId is given, the tool uses whatever is currently selected in Figma.

**Design-to-code workflow:** call \`get_screenshot\` first for visual reference, then \`get_design_context\` for layout and structure. If the response is too large, use \`get_metadata\` to get an overview, then \`get_design_context\` on specific child nodes.
`,
    };
  });

  // ## Commands

  pi.registerCommand("figma-remote", {
    description:
      "Show Figma remote MCP server connection status and available tools",
    handler: async (_args, ctx) => {
      if (!connected) {
        ctx.ui.notify(
          "Figma remote MCP server is not connected.\n\nRun /figma-remote-auth to authenticate.",
          "error"
        );
        return;
      }
      ctx.ui.notify(
        `Figma remote MCP server connected ✓\nURL: ${MCP_URL}\n\nAvailable tools (${availableTools.length}):\n${availableTools.map((t) => `  • ${t.name}`).join("\n")}`,
        "success"
      );
    },
  });

  pi.registerCommand("figma-remote-auth", {
    description: "Authenticate with the Figma remote MCP server via OAuth",
    handler: async (_args, ctx) => {
      try {
        await runFullOAuthFlow(ctx);

        const signal = AbortSignal.timeout(15_000);
        const ok = await initializeSession(signal);
        if (!ok) {
          ctx.ui.notify(
            "OAuth completed but could not initialize MCP session.",
            "error"
          );
          return;
        }
        const tools = await listTools(signal);
        connected = true;
        ctx.ui.setStatus("figma-remote", "figma-remote ✓");
        registerMcpTools(pi, tools);
        ctx.ui.notify(
          `Authenticated ✓\n\nAvailable tools (${tools.length}):\n${tools.map((t) => `  • ${t.name}`).join("\n")}`,
          "success"
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.ui.notify(`Authentication error: ${msg}`, "error");
      }
    },
  });
}
