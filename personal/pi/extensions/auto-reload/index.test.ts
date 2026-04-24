import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Helpers ────────────────────────────────────────────────────────────────

const GLOBAL_KEY = "__piAutoReload";

type HandlerFn = (...args: any[]) => void | Promise<void>;

function createMockPi() {
	const commands = new Map<string, { description: string; handler: HandlerFn }>();
	let registeredTool: any = null;

	return {
		registerCommand: vi.fn((name: string, opts: any) => {
			commands.set(name, opts);
		}),
		registerTool: vi.fn((tool: any) => {
			registeredTool = tool;
		}),
		on: vi.fn(),
		sendUserMessage: vi.fn(),
		getCommand: (name: string) => commands.get(name),
		getTool: () => registeredTool,
	};
}

function createMockCommandCtx() {
	return {
		reload: vi.fn(async () => {}),
		waitForIdle: vi.fn(async () => {}),
		ui: {
			notify: vi.fn(),
			confirm: vi.fn(async () => true),
		},
	};
}

async function freshInit() {
	// Clear globalThis state between tests
	delete (globalThis as any)[GLOBAL_KEY];
	const mod = await import("./index.js");
	const pi = createMockPi();
	mod.default(pi as any);
	return pi;
}

// ── Tests ──────────────────────────────────────────────────────────────────

beforeEach(() => {
	vi.clearAllMocks();
	vi.resetModules();
	delete (globalThis as any)[GLOBAL_KEY];
});

describe("auto-reload extension", () => {
	describe("registration", () => {
		it("registers /auto-reload command and reload_extensions tool", async () => {
			const pi = await freshInit();

			expect(pi.registerCommand).toHaveBeenCalledWith("auto-reload", expect.any(Object));
			expect(pi.registerTool).toHaveBeenCalledWith(
				expect.objectContaining({
					name: "reload_extensions",
					label: "Reload Extensions",
				}),
			);
		});

		it("tool has promptGuidelines for agent behavior", async () => {
			const pi = await freshInit();
			const tool = pi.getTool();

			expect(tool.promptGuidelines).toEqual(
				expect.arrayContaining([
					expect.stringContaining("reload_extensions"),
				]),
			);
		});
	});

	describe("/auto-reload command", () => {
		it("enables auto-reload on first run", async () => {
			const pi = await freshInit();
			const ctx = createMockCommandCtx();

			await pi.getCommand("auto-reload")!.handler("", ctx);

			expect(ctx.ui.notify).toHaveBeenCalledWith("Auto-reload: on", "info");
		});

		it("captures reload and waitForIdle from command context", async () => {
			const pi = await freshInit();
			const ctx = createMockCommandCtx();

			await pi.getCommand("auto-reload")!.handler("", ctx);

			const state = (globalThis as any)[GLOBAL_KEY];
			expect(state.enabled).toBe(true);
			expect(state.reload).toBeTypeOf("function");
			expect(state.waitForIdle).toBeTypeOf("function");
		});

		it("toggles off on second run", async () => {
			const pi = await freshInit();
			const ctx = createMockCommandCtx();

			await pi.getCommand("auto-reload")!.handler("", ctx);
			await pi.getCommand("auto-reload")!.handler("", ctx);

			expect(ctx.ui.notify).toHaveBeenLastCalledWith("Auto-reload: off", "info");
			const state = (globalThis as any)[GLOBAL_KEY];
			expect(state.enabled).toBe(false);
			expect(state.reload).toBeNull();
			expect(state.waitForIdle).toBeNull();
		});

		it("toggles back on after being disabled", async () => {
			const pi = await freshInit();
			const ctx = createMockCommandCtx();

			await pi.getCommand("auto-reload")!.handler("", ctx); // on
			await pi.getCommand("auto-reload")!.handler("", ctx); // off
			await pi.getCommand("auto-reload")!.handler("", ctx); // on

			expect(ctx.ui.notify).toHaveBeenLastCalledWith("Auto-reload: on", "info");
			const state = (globalThis as any)[GLOBAL_KEY];
			expect(state.enabled).toBe(true);
			expect(state.reload).toBeTypeOf("function");
		});
	});

	describe("reload_extensions tool", () => {
		it("returns not-enabled message when not bootstrapped", async () => {
			const pi = await freshInit();
			const tool = pi.getTool();

			const result = await tool.execute("call-1", {}, undefined, vi.fn());

			expect(result.content[0].text).toContain("not enabled");
			expect(result.content[0].text).toContain("/auto-reload");
		});

		it("fires waitForIdle then reload then sendUserMessage when enabled", async () => {
			const pi = await freshInit();
			const ctx = createMockCommandCtx();
			const tool = pi.getTool();

			// Enable auto-reload
			await pi.getCommand("auto-reload")!.handler("", ctx);

			const result = await tool.execute("call-1", {}, undefined, vi.fn());

			expect(result.content[0].text).toContain("Reloading extensions");
			expect(result.content[0].text).toContain("Stop here");

			// Let the fire-and-forget doReload() resolve
			await vi.waitFor(() => {
				expect(ctx.waitForIdle).toHaveBeenCalled();
			});
			await vi.waitFor(() => {
				expect(ctx.reload).toHaveBeenCalled();
			});
			await vi.waitFor(() => {
				expect(pi.sendUserMessage).toHaveBeenCalledWith(
					"Reload complete. Continue where you left off.",
				);
			});
		});

		it("calls waitForIdle before reload", async () => {
			const pi = await freshInit();
			const callOrder: string[] = [];
			const ctx = createMockCommandCtx();
			ctx.waitForIdle.mockImplementation(async () => {
				callOrder.push("waitForIdle");
			});
			ctx.reload.mockImplementation(async () => {
				callOrder.push("reload");
			});
			const tool = pi.getTool();

			await pi.getCommand("auto-reload")!.handler("", ctx);
			await tool.execute("call-1", {}, undefined, vi.fn());

			await vi.waitFor(() => {
				expect(callOrder).toEqual(["waitForIdle", "reload"]);
			});
		});

		it("returns not-enabled after toggling off", async () => {
			const pi = await freshInit();
			const ctx = createMockCommandCtx();
			const tool = pi.getTool();

			await pi.getCommand("auto-reload")!.handler("", ctx); // on
			await pi.getCommand("auto-reload")!.handler("", ctx); // off

			const result = await tool.execute("call-1", {}, undefined, vi.fn());
			expect(result.content[0].text).toContain("not enabled");
		});
	});

	describe("globalThis persistence", () => {
		it("survives re-initialization (simulates reload)", async () => {
			// First init + enable
			const pi1 = await freshInit();
			const ctx = createMockCommandCtx();
			await pi1.getCommand("auto-reload")!.handler("", ctx);

			// Verify state is on globalThis
			const state = (globalThis as any)[GLOBAL_KEY];
			expect(state.enabled).toBe(true);

			// Second init (simulates extension reload) — don't clear globalThis
			vi.resetModules();
			const mod2 = await import("./index.js");
			const pi2 = createMockPi();
			mod2.default(pi2 as any);
			const tool2 = pi2.getTool();

			// Tool should work without re-bootstrapping
			const result = await tool2.execute("call-1", {}, undefined, vi.fn());
			expect(result.content[0].text).toContain("Reloading extensions");
		});

		it("does not persist across fresh sessions (globalThis cleared)", async () => {
			const pi1 = await freshInit();
			const ctx = createMockCommandCtx();
			await pi1.getCommand("auto-reload")!.handler("", ctx);

			// Simulate new session — clear globalThis
			delete (globalThis as any)[GLOBAL_KEY];
			vi.resetModules();
			const mod2 = await import("./index.js");
			const pi2 = createMockPi();
			mod2.default(pi2 as any);
			const tool2 = pi2.getTool();

			const result = await tool2.execute("call-1", {}, undefined, vi.fn());
			expect(result.content[0].text).toContain("not enabled");
		});

	});

	describe("error handling", () => {
		it("sends failure message when reload rejects", async () => {
			const pi = await freshInit();
			const ctx = createMockCommandCtx();
			ctx.reload.mockRejectedValue(new Error("syntax error in extension"));
			const tool = pi.getTool();

			await pi.getCommand("auto-reload")!.handler("", ctx);
			await tool.execute("call-1", {}, undefined, vi.fn());

			await vi.waitFor(() => {
				expect(pi.sendUserMessage).toHaveBeenCalledWith(
					"Reload failed. Check the extension for errors and try again.",
				);
			});
		});

		it("sends failure message when waitForIdle rejects", async () => {
			const pi = await freshInit();
			const ctx = createMockCommandCtx();
			ctx.waitForIdle.mockRejectedValue(new Error("session closed"));
			const tool = pi.getTool();

			await pi.getCommand("auto-reload")!.handler("", ctx);
			await tool.execute("call-1", {}, undefined, vi.fn());

			await vi.waitFor(() => {
				expect(pi.sendUserMessage).toHaveBeenCalledWith(
					"Reload failed. Check the extension for errors and try again.",
				);
			});
		});
	});
});
