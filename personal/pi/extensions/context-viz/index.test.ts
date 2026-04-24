/**
 * Tests for context-viz extension.
 *
 * Run: npx vitest run extensions/context-viz/index.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@mariozechner/pi-ai", () => ({}));
vi.mock("@mariozechner/pi-coding-agent", () => ({}));
vi.mock("@mariozechner/pi-tui", () => ({
  matchesKey: (data: string, key: string) => {
    const map: Record<string, string> = {
      escape: "\x1b",
      return: "\r",
      q: "q",
    };
    return data === map[key];
  },
  visibleWidth: (str: string) => str.replace(/\x1b\[[^m]*m/g, "").length,
}));

// ── Import the module (dynamic so mocks are in place) ──────────────────────

const mod = await import("./index.js");
const registerExtension = mod.default;

// ── Helpers ────────────────────────────────────────────────────────────────

function makeTheme(): any {
  return {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  };
}

function makePi() {
  const commands: Record<string, any> = {};
  return {
    registerCommand: vi.fn((name: string, opts: any) => {
      commands[name] = opts;
    }),
    _commands: commands,
  };
}

/** Build a minimal ExtensionCommandContext. */
function makeCtx(opts: {
  branch?: any[];
  systemPrompt?: string;
  contextWindow?: number;
  reportedTokens?: number | null;
  modelId?: string;
  sessionName?: string;
  hasUI?: boolean;
} = {}) {
  return {
    hasUI: opts.hasUI ?? true,
    model: {
      id: opts.modelId ?? "test-model",
      contextWindow: opts.contextWindow ?? 200_000,
    },
    sessionManager: {
      getBranch: () => opts.branch ?? [],
      getSessionName: () => opts.sessionName ?? undefined,
    },
    getSystemPrompt: () => opts.systemPrompt ?? "",
    getContextUsage: () => ({
      tokens: opts.reportedTokens ?? null,
      contextWindow: opts.contextWindow ?? 200_000,
    }),
    ui: {
      notify: vi.fn(),
      custom: vi.fn(async (factory: any) => {
        const theme = makeTheme();
        let resolved = false;
        const done = () => { resolved = true; };
        const overlay = factory(null, theme, null, done);
        // Render once to exercise the rendering path
        overlay.render(100);
        // Simulate close
        overlay.handleInput("\r");
        return undefined;
      }),
    },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("context-viz", () => {
  let pi: ReturnType<typeof makePi>;

  beforeEach(() => {
    pi = makePi();
    registerExtension(pi as any);
  });

  it("registers the /context command", () => {
    expect(pi.registerCommand).toHaveBeenCalledWith("context", expect.any(Object));
    expect(pi._commands.context.description).toBeTruthy();
  });

  describe("/context (overlay mode)", () => {
    it("opens overlay with empty branch", async () => {
      const ctx = makeCtx();
      await pi._commands.context.handler("", ctx);
      expect(ctx.ui.custom).toHaveBeenCalledOnce();
    });

    it("renders with all message types", async () => {
      const branch = [
        // user text string
        { type: "message", message: { role: "user", content: "hello" } },
        // user text array
        { type: "message", message: { role: "user", content: [{ type: "text", text: "world" }] } },
        // assistant with text + thinking + toolCall
        {
          type: "message",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "reply" },
              { type: "thinking", thinking: "hmm" },
              { type: "toolCall", name: "bash", arguments: { cmd: "ls" } },
            ],
          },
        },
        // toolResult string
        { type: "message", message: { role: "toolResult", content: "output" } },
        // toolResult array with image
        {
          type: "message",
          message: {
            role: "toolResult",
            content: [
              { type: "text", text: "file" },
              { type: "image", data: "base64..." },
            ],
          },
        },
        // bash execution
        { type: "message", message: { role: "bashExecution", command: "ls -la", output: "total 0" } },
        // custom role string
        { type: "message", message: { role: "custom", content: "ext data" } },
        // custom role array with image
        { type: "message", message: { role: "custom", content: [{ type: "text", text: "a" }, { type: "image" }] } },
        // branchSummary
        { type: "branch_summary", summary: "branch summary text" },
        // compaction
        { type: "compaction", summary: "compacted" },
        // custom_message
        { type: "custom_message", content: "injected" },
        // unknown entry type (should be skipped)
        { type: "unknown_type", data: "ignored" },
        // unknown message role (should be skipped)
        { type: "message", message: { role: "unknown_role", content: "x" } },
      ];

      const ctx = makeCtx({ branch, systemPrompt: "You are a helpful assistant.", reportedTokens: 5000 });
      await pi._commands.context.handler("", ctx);
      expect(ctx.ui.custom).toHaveBeenCalledOnce();
    });

    it("renders with no context window (zero)", async () => {
      const ctx = makeCtx({ contextWindow: 0, reportedTokens: null });
      await pi._commands.context.handler("", ctx);
      expect(ctx.ui.custom).toHaveBeenCalledOnce();
    });

    it("renders with reported tokens null", async () => {
      const ctx = makeCtx({ reportedTokens: null, systemPrompt: "sys" });
      await pi._commands.context.handler("", ctx);
      expect(ctx.ui.custom).toHaveBeenCalledOnce();
    });

    it("degrades gracefully when getContextUsage throws", async () => {
      const ctx = makeCtx({ systemPrompt: "sys" });
      ctx.getContextUsage = () => { throw new Error("boom"); };
      await pi._commands.context.handler("", ctx);
      expect(ctx.ui.custom).toHaveBeenCalledOnce();
    });

    it("renders with session name", async () => {
      const ctx = makeCtx({ sessionName: "my-session" });
      await pi._commands.context.handler("", ctx);
      expect(ctx.ui.custom).toHaveBeenCalledOnce();
    });
  });

  describe("/context print", () => {
    it("prints text summary for 'print' arg", async () => {
      const branch = [
        { type: "message", message: { role: "user", content: "hi" } },
      ];
      const ctx = makeCtx({ branch, reportedTokens: 100 });
      await pi._commands.context.handler("print", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledOnce();
      const text = ctx.ui.notify.mock.calls[0][0] as string;
      expect(text).toContain("context");
      expect(text).toContain("test-model");
    });

    it("prints text summary for '-p' arg", async () => {
      const ctx = makeCtx();
      await pi._commands.context.handler("-p", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledOnce();
    });

    it("falls back to print when hasUI is false", async () => {
      const ctx = makeCtx({ hasUI: false });
      await pi._commands.context.handler("", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledOnce();
    });

    it("prints without context window", async () => {
      const ctx = makeCtx({ contextWindow: 0, reportedTokens: null });
      await pi._commands.context.handler("print", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledOnce();
      const text = ctx.ui.notify.mock.calls[0][0] as string;
      expect(text).not.toContain("free");
    });

    it("prints with context window showing free line", async () => {
      const ctx = makeCtx({ contextWindow: 200_000 });
      await pi._commands.context.handler("print", ctx);
      const text = ctx.ui.notify.mock.calls[0][0] as string;
      expect(text).toContain("free");
    });

    it("prints without reported tokens", async () => {
      const ctx = makeCtx({ reportedTokens: null });
      await pi._commands.context.handler("print", ctx);
      const text = ctx.ui.notify.mock.calls[0][0] as string;
      expect(text).not.toContain("reported=");
    });

    it("prints with reported tokens", async () => {
      const ctx = makeCtx({ reportedTokens: 5000 });
      await pi._commands.context.handler("print", ctx);
      const text = ctx.ui.notify.mock.calls[0][0] as string;
      expect(text).toContain("reported=");
    });
  });

  describe("overlay input handling", () => {
    it("closes on escape", async () => {
      const ctx = makeCtx();
      ctx.ui.custom = vi.fn(async (factory: any) => {
        const theme = makeTheme();
        let closed = false;
        const overlay = factory(null, theme, null, () => { closed = true; });
        overlay.handleInput("\x1b");
        expect(closed).toBe(true);
        return undefined;
      });
      await pi._commands.context.handler("", ctx);
    });

    it("closes on q", async () => {
      const ctx = makeCtx();
      ctx.ui.custom = vi.fn(async (factory: any) => {
        const theme = makeTheme();
        let closed = false;
        const overlay = factory(null, theme, null, () => { closed = true; });
        overlay.handleInput("q");
        expect(closed).toBe(true);
        return undefined;
      });
      await pi._commands.context.handler("", ctx);
    });

    it("ignores non-close keys", async () => {
      const ctx = makeCtx();
      ctx.ui.custom = vi.fn(async (factory: any) => {
        const theme = makeTheme();
        let closed = false;
        const overlay = factory(null, theme, null, () => { closed = true; });
        overlay.handleInput("x");
        expect(closed).toBe(false);
        return undefined;
      });
      await pi._commands.context.handler("", ctx);
    });

    it("overlay has width and focus properties", async () => {
      const ctx = makeCtx();
      ctx.ui.custom = vi.fn(async (factory: any) => {
        const theme = makeTheme();
        const overlay = factory(null, theme, null, () => {});
        expect(overlay.width).toBe(86);
        expect(overlay.focused).toBe(false);
        // Exercise dispose and invalidate (no-ops)
        overlay.invalidate();
        overlay.dispose();
        return undefined;
      });
      await pi._commands.context.handler("", ctx);
    });
  });

  describe("snapshot edge cases", () => {
    it("handles getSystemPrompt throwing", async () => {
      const ctx = makeCtx();
      ctx.getSystemPrompt = () => { throw new Error("no prompt"); };
      await pi._commands.context.handler("print", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledOnce();
    });

    it("handles missing getSystemPrompt", async () => {
      const ctx = makeCtx();
      (ctx as any).getSystemPrompt = undefined;
      await pi._commands.context.handler("print", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledOnce();
    });

    it("handles missing getContextUsage", async () => {
      const ctx = makeCtx();
      (ctx as any).getContextUsage = undefined;
      await pi._commands.context.handler("print", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledOnce();
    });

    it("falls back to model.contextWindow when usage.contextWindow is missing", async () => {
      const ctx = makeCtx({ contextWindow: 100_000 });
      // Override getContextUsage to return no contextWindow, forcing model fallback
      ctx.getContextUsage = () => ({ tokens: 500, contextWindow: undefined as any });
      await pi._commands.context.handler("print", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledOnce();
    });

    it("handles missing model", async () => {
      const ctx = makeCtx();
      (ctx as any).model = undefined;
      await pi._commands.context.handler("print", ctx);
      const text = ctx.ui.notify.mock.calls[0][0] as string;
      expect(text).toContain("no-model");
    });

    it("falls through to 0 when both usage and model contextWindow are missing", async () => {
      const ctx = makeCtx();
      ctx.getContextUsage = () => ({ tokens: null, contextWindow: undefined as any });
      (ctx as any).model = { id: "test", contextWindow: undefined };
      await pi._commands.context.handler("print", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledOnce();
    });

    it("handles missing getSessionName", async () => {
      const ctx = makeCtx();
      (ctx as any).sessionManager.getSessionName = undefined;
      await pi._commands.context.handler("print", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledOnce();
    });
  });

  describe("fmt helper coverage", () => {
    it("handles various token ranges through print output", async () => {
      // < 1000
      const ctx1 = makeCtx({ branch: [{ type: "message", message: { role: "user", content: "hi" } }], contextWindow: 500 });
      await pi._commands.context.handler("print", ctx1);
      // The "free" line should show a small number
      expect(ctx1.ui.notify).toHaveBeenCalledOnce();

      // 1000–9999 (2 decimal k)
      const bigStr = "x".repeat(20_000); // ~5k tokens
      const ctx2 = makeCtx({ branch: [{ type: "message", message: { role: "user", content: bigStr } }], contextWindow: 20_000 });
      await pi._commands.context.handler("print", ctx2);
      expect(ctx2.ui.notify).toHaveBeenCalledOnce();

      // 10k+ (1 decimal k)
      const hugeStr = "x".repeat(200_000); // ~50k tokens
      const ctx3 = makeCtx({ branch: [{ type: "message", message: { role: "user", content: hugeStr } }], contextWindow: 200_000 });
      await pi._commands.context.handler("print", ctx3);
      expect(ctx3.ui.notify).toHaveBeenCalledOnce();

      // 1M+ range
      const megaStr = "x".repeat(8_000_000); // ~2M tokens
      const ctx4 = makeCtx({ branch: [{ type: "message", message: { role: "user", content: megaStr } }], contextWindow: 4_000_000 });
      await pi._commands.context.handler("print", ctx4);
      expect(ctx4.ui.notify).toHaveBeenCalledOnce();
    });
  });

  describe("pct helper coverage", () => {
    it("shows <0.1% for tiny fractions", async () => {
      // 1 token out of 200k → <0.1%
      const ctx = makeCtx({
        branch: [{ type: "message", message: { role: "user", content: "x" } }],
        contextWindow: 200_000,
      });
      await pi._commands.context.handler("print", ctx);
      const text = ctx.ui.notify.mock.calls[0][0] as string;
      expect(text).toContain("<0.1%");
    });

    it("shows dash for zero context window in overlay", async () => {
      const ctx = makeCtx({ contextWindow: 0, reportedTokens: null });
      ctx.ui.custom = vi.fn(async (factory: any) => {
        const theme = makeTheme();
        const overlay = factory(null, theme, null, () => {});
        const lines = overlay.render(100);
        // Should contain "–" somewhere for the unavailable percentage
        const joined = lines.join("\n");
        expect(joined).toContain("–");
        return undefined;
      });
      await pi._commands.context.handler("", ctx);
    });

    it("renders overlay with zero context window and reported tokens", async () => {
      const ctx = makeCtx({ contextWindow: 0, reportedTokens: 500 });
      ctx.ui.custom = vi.fn(async (factory: any) => {
        const theme = makeTheme();
        const overlay = factory(null, theme, null, () => {});
        const lines = overlay.render(100);
        expect(lines.length).toBeGreaterThan(5);
        return undefined;
      });
      await pi._commands.context.handler("", ctx);
    });
  });

  describe("donut rendering with large categories", () => {
    it("renders donut with multiple non-zero categories", async () => {
      const branch = [
        { type: "message", message: { role: "user", content: "x".repeat(4000) } },
        {
          type: "message",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "y".repeat(4000) },
              { type: "thinking", thinking: "z".repeat(4000) },
            ],
          },
        },
        { type: "message", message: { role: "toolResult", content: "r".repeat(4000) } },
        { type: "message", message: { role: "bashExecution", command: "cmd", output: "o".repeat(4000) } },
      ];
      const ctx = makeCtx({ branch, systemPrompt: "s".repeat(4000), contextWindow: 50_000, reportedTokens: 8000 });
      ctx.ui.custom = vi.fn(async (factory: any) => {
        const theme = makeTheme();
        const overlay = factory(null, theme, null, () => {});
        const lines = overlay.render(100);
        expect(lines.length).toBeGreaterThan(10);
        return undefined;
      });
      await pi._commands.context.handler("", ctx);
    });

    it("renders donut with empty center text entry", async () => {
      // When contextWindow is 0 and no reportedTokens, center text has empty entries
      const ctx = makeCtx({ contextWindow: 0, reportedTokens: null });
      ctx.ui.custom = vi.fn(async (factory: any) => {
        const theme = makeTheme();
        const overlay = factory(null, theme, null, () => {});
        const lines = overlay.render(100);
        expect(lines.length).toBeGreaterThan(5);
        return undefined;
      });
      await pi._commands.context.handler("", ctx);
    });

    it("exercises all donut zip fallback paths with many legend rows", async () => {
      // Create enough categories with tokens so legendRows > donutLines,
      // triggering the donutLines[i] ?? fallback
      const branch: any[] = [];
      for (let i = 0; i < 20; i++) {
        branch.push({ type: "message", message: { role: "user", content: "x".repeat(400) } });
        branch.push({ type: "message", message: { role: "toolResult", content: "y".repeat(400) } });
        branch.push({ type: "message", message: { role: "bashExecution", command: "c", output: "o".repeat(400) } });
      }
      const ctx = makeCtx({ branch, contextWindow: 100_000, systemPrompt: "s".repeat(400) });
      ctx.ui.custom = vi.fn(async (factory: any) => {
        const theme = makeTheme();
        const overlay = factory(null, theme, null, () => {});
        const lines = overlay.render(100);
        expect(lines.length).toBeGreaterThan(15);
        return undefined;
      });
      await pi._commands.context.handler("", ctx);
    });
  });

  describe("user content edge cases", () => {
    it("handles user content as non-text array blocks", async () => {
      const ctx = makeCtx({
        branch: [
          { type: "message", message: { role: "user", content: [{ type: "image" }] } },
        ],
      });
      await pi._commands.context.handler("print", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledOnce();
    });

    it("handles user content that is neither string nor array", async () => {
      const ctx = makeCtx({
        branch: [
          { type: "message", message: { role: "user", content: 42 } },
        ],
      });
      await pi._commands.context.handler("print", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledOnce();
    });

    it("handles assistant with only toolCalls", async () => {
      const ctx = makeCtx({
        branch: [
          {
            type: "message",
            message: {
              role: "assistant",
              content: [{ type: "toolCall", name: "read", arguments: { path: "/tmp" } }],
            },
          },
        ],
      });
      await pi._commands.context.handler("print", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledOnce();
    });

    it("handles assistant with string content", async () => {
      const ctx = makeCtx({
        branch: [
          {
            type: "message",
            message: {
              role: "assistant",
              content: "plain string reply",
            },
          },
        ],
      });
      await pi._commands.context.handler("print", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledOnce();
      const text = ctx.ui.notify.mock.calls[0][0] as string;
      expect(text).toContain("assistant");
    });

    it("handles user messages with images", async () => {
      const ctx = makeCtx({
        branch: [
          {
            type: "message",
            message: {
              role: "user",
              content: [
                { type: "text", text: "look at this" },
                { type: "image", data: "base64..." },
              ],
            },
          },
        ],
      });
      await pi._commands.context.handler("print", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledOnce();
      const text = ctx.ui.notify.mock.calls[0][0] as string;
      expect(text).toContain("user");
    });

    it("handles toolResult with null content", async () => {
      const ctx = makeCtx({
        branch: [
          { type: "message", message: { role: "toolResult", content: null } },
          { type: "message", message: { role: "toolResult" } },
        ],
      });
      await pi._commands.context.handler("print", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledOnce();
    });

    it("handles custom with null content", async () => {
      const ctx = makeCtx({
        branch: [
          { type: "message", message: { role: "custom", content: null } },
          { type: "message", message: { role: "custom" } },
        ],
      });
      await pi._commands.context.handler("print", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledOnce();
    });

    it("handles assistant with unknown block type", async () => {
      const ctx = makeCtx({
        branch: [
          {
            type: "message",
            message: {
              role: "assistant",
              content: [{ type: "redacted", data: "xxx" }],
            },
          },
        ],
      });
      await pi._commands.context.handler("print", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledOnce();
    });
  });
});
