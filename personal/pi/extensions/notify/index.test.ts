import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks (hoisted above all imports) ──────────────────────────────────────

vi.mock("node:child_process", () => ({
	execFileSync: vi.fn(() => ""),
}));

// Static import AFTER vi.mock — gives us a typed reference to the mock.
import { execFileSync } from "node:child_process";

const mockExecFileSync = vi.mocked(execFileSync);

// ── Helpers ────────────────────────────────────────────────────────────────

type HandlerFn = (...args: any[]) => void | Promise<void>;

function createMockPi() {
	const onHandlers = new Map<string, HandlerFn[]>();
	const eventHandlers = new Map<string, HandlerFn[]>();
	let sessionName = "";

	return {
		on: vi.fn((event: string, handler: HandlerFn) => {
			if (!onHandlers.has(event)) onHandlers.set(event, []);
			onHandlers.get(event)!.push(handler);
		}),
		events: {
			on: vi.fn((event: string, handler: HandlerFn) => {
				if (!eventHandlers.has(event)) eventHandlers.set(event, []);
				eventHandlers.get(event)!.push(handler);
			}),
		},
		registerCommand: vi.fn(),
		getSessionName: vi.fn(() => sessionName),
		setSessionName: (name: string) => { sessionName = name; },
		fireOn: async (event: string, ...args: any[]) => {
			for (const h of onHandlers.get(event) ?? []) await h(...args);
		},
		fireEvent: async (event: string, ...args: any[]) => {
			for (const h of eventHandlers.get(event) ?? []) await h(...args);
		},
	};
}

// Save/restore env vars touched by the module
const ENV_KEYS = ["CMUX_WORKSPACE_ID", "CMUX_SURFACE_ID", "PI_MODE"];
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
	vi.clearAllMocks();
	savedEnv = {};
	for (const k of ENV_KEYS) {
		savedEnv[k] = process.env[k];
		delete process.env[k];
	}
});

afterEach(() => {
	for (const k of ENV_KEYS) {
		if (savedEnv[k] === undefined) delete process.env[k];
		else process.env[k] = savedEnv[k];
	}
	vi.restoreAllMocks();
	vi.resetModules();
});

// Helper: import a fresh module instance
async function freshInit() {
	const mod = await import("./index.js");
	const pi = createMockPi();
	mod.default(pi as any);
	return pi;
}

// Helper: trigger notification via agent_end + debounce
async function triggerNotification(pi: ReturnType<typeof createMockPi>, content: string = "done") {
	await pi.fireOn("agent_end", { messages: [{ role: "assistant", content }] });
	vi.advanceTimersByTime(6000);
}

// Helper: find the `cmux notify` call (if any)
function findCmuxCall() {
	return mockExecFileSync.mock.calls.find(
		(c: any[]) => c[0] === "cmux" && (c[1] as string[])?.[0] === "notify",
	);
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("notify extension", () => {
	describe("registration", () => {
		it("registers agent_start, agent_end, notify:disable, notify:send, and /notify command", async () => {
			const pi = await freshInit();

			expect(pi.on).toHaveBeenCalledWith("agent_start", expect.any(Function));
			expect(pi.on).toHaveBeenCalledWith("agent_end", expect.any(Function));
			expect(pi.events.on).toHaveBeenCalledWith("notify:disable", expect.any(Function));
			expect(pi.events.on).toHaveBeenCalledWith("notify:send", expect.any(Function));
			expect(pi.registerCommand).toHaveBeenCalledWith("notify", expect.any(Object));
		});
	});

	describe("debounce behavior", () => {
		it("agent_start cancels pending notification from agent_end", async () => {
			vi.useFakeTimers();
			process.env.CMUX_WORKSPACE_ID = "ws-uuid";
			const pi = await freshInit();

			await pi.fireOn("agent_end", { messages: [{ role: "assistant", content: "done" }] });
			await pi.fireOn("agent_start");
			vi.advanceTimersByTime(6000);

			// No notification path should have been called
			expect(findCmuxCall()).toBeUndefined();
			expect(mockExecFileSync).not.toHaveBeenCalledWith(
				"osascript", expect.anything(), expect.anything(),
			);

			vi.useRealTimers();
		});
	});

	describe("notify:disable", () => {
		it("suppresses notifications when disabled", async () => {
			vi.useFakeTimers();
			process.env.CMUX_WORKSPACE_ID = "ws-uuid";
			const pi = await freshInit();
			await pi.fireEvent("notify:disable");

			await triggerNotification(pi);

			expect(findCmuxCall()).toBeUndefined();

			vi.useRealTimers();
		});
	});

	describe("RPC mode", () => {
		it("emits JSON to stdout in PI_MODE=rpc and short-circuits", async () => {
			vi.useFakeTimers();
			process.env.PI_MODE = "rpc";
			process.env.CMUX_WORKSPACE_ID = "ws-uuid";
			const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

			const pi = await freshInit();
			await triggerNotification(pi, "hello");

			expect(writeSpy).toHaveBeenCalledWith(
				expect.stringContaining('"type":"desktop_notification"'),
			);
			// Should not fall through to cmux
			expect(findCmuxCall()).toBeUndefined();

			vi.useRealTimers();
		});
	});

	describe("cmux notification path", () => {
		it("calls `cmux notify` targeting the surface when inside cmux", async () => {
			vi.useFakeTimers();
			process.env.CMUX_WORKSPACE_ID = "ws-uuid";
			process.env.CMUX_SURFACE_ID = "surf-uuid";

			const pi = await freshInit();
			await triggerNotification(pi, "build done");

			const call = findCmuxCall();
			expect(call).toBeDefined();
			const args = call![1] as string[];
			expect(args).toContain("--title");
			expect(args).toContain("--body");
			expect(args[args.indexOf("--body") + 1]).toBe("build done");
			expect(args).toContain("--surface");
			expect(args[args.indexOf("--surface") + 1]).toBe("surf-uuid");
			// Surface set → should NOT also pass --workspace
			expect(args).not.toContain("--workspace");

			vi.useRealTimers();
		});

		it("falls back to --workspace when only CMUX_WORKSPACE_ID is set", async () => {
			vi.useFakeTimers();
			process.env.CMUX_WORKSPACE_ID = "ws-uuid";
			// No CMUX_SURFACE_ID

			const pi = await freshInit();
			await triggerNotification(pi);

			const call = findCmuxCall();
			expect(call).toBeDefined();
			const args = call![1] as string[];
			expect(args).toContain("--workspace");
			expect(args[args.indexOf("--workspace") + 1]).toBe("ws-uuid");
			expect(args).not.toContain("--surface");

			vi.useRealTimers();
		});

		it("does not invoke cmux when outside cmux", async () => {
			vi.useFakeTimers();
			// No CMUX_* env
			const pi = await freshInit();
			await triggerNotification(pi);

			expect(findCmuxCall()).toBeUndefined();
			// Should fall back to osascript
			const osaCall = mockExecFileSync.mock.calls.find((c: any[]) => c[0] === "osascript");
			expect(osaCall).toBeDefined();

			vi.useRealTimers();
		});
	});

	describe("osascript fallback", () => {
		it("uses osascript when cmux notify throws", async () => {
			vi.useFakeTimers();
			process.env.CMUX_WORKSPACE_ID = "ws-uuid";
			mockExecFileSync.mockImplementation((cmd: string) => {
				if (cmd === "cmux") throw new Error("cmux not running");
				return "";
			});

			const pi = await freshInit();
			await triggerNotification(pi);

			const osaCall = mockExecFileSync.mock.calls.find((c: any[]) => c[0] === "osascript");
			expect(osaCall).toBeDefined();

			vi.useRealTimers();
		});
	});

	describe("extractLastText + summarize", () => {
		// Use RPC mode for clean output inspection (avoids OS-specific paths)
		it("truncates long text to 200 chars with ellipsis", async () => {
			vi.useFakeTimers();
			process.env.PI_MODE = "rpc";
			const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

			const pi = await freshInit();
			await triggerNotification(pi, "A".repeat(300));

			const parsed = JSON.parse(writeSpy.mock.calls[0][0] as string);
			expect(parsed.body.length).toBeLessThanOrEqual(200);
			expect(parsed.body).toContain("…");

			vi.useRealTimers();
		});

		it("returns 'Ready for input' when no assistant message", async () => {
			vi.useFakeTimers();
			process.env.PI_MODE = "rpc";
			const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

			const pi = await freshInit();
			await pi.fireOn("agent_end", { messages: [{ role: "user", content: "hi" }] });
			vi.advanceTimersByTime(6000);

			const parsed = JSON.parse(writeSpy.mock.calls[0][0] as string);
			expect(parsed.body).toBe("Ready for input");

			vi.useRealTimers();
		});

		it("joins structured content text parts", async () => {
			vi.useFakeTimers();
			process.env.PI_MODE = "rpc";
			const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

			const pi = await freshInit();
			await pi.fireOn("agent_end", {
				messages: [{
					role: "assistant",
					content: [{ type: "text", text: "Hello " }, { type: "text", text: "world" }],
				}],
			});
			vi.advanceTimersByTime(6000);

			const parsed = JSON.parse(writeSpy.mock.calls[0][0] as string);
			expect(parsed.body).toContain("Hello");
			expect(parsed.body).toContain("world");

			vi.useRealTimers();
		});

		it("strips markdown formatting", async () => {
			vi.useFakeTimers();
			process.env.PI_MODE = "rpc";
			const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

			const pi = await freshInit();
			await triggerNotification(pi, "# Hello **world** `code`");

			const parsed = JSON.parse(writeSpy.mock.calls[0][0] as string);
			expect(parsed.body).toBe("Hello world code");

			vi.useRealTimers();
		});
	});

	describe("session name in title", () => {
		it("includes session name when set", async () => {
			vi.useFakeTimers();
			process.env.PI_MODE = "rpc";
			const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

			const pi = await freshInit();
			pi.setSessionName("fix build bug");
			await triggerNotification(pi);

			const parsed = JSON.parse(writeSpy.mock.calls[0][0] as string);
			expect(parsed.title).toBe("π: fix build bug");

			vi.useRealTimers();
		});

		it("uses bare π when no session name", async () => {
			vi.useFakeTimers();
			process.env.PI_MODE = "rpc";
			const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

			const pi = await freshInit();
			await triggerNotification(pi);

			const parsed = JSON.parse(writeSpy.mock.calls[0][0] as string);
			expect(parsed.title).toBe("π");

			vi.useRealTimers();
		});
	});
});
