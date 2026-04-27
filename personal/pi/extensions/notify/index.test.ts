import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks (hoisted above all imports) ──────────────────────────────────────

vi.mock("node:child_process", () => ({
	execFileSync: vi.fn(() => ""),
}));

vi.mock("node:fs", () => ({
	openSync: vi.fn(() => 99),
	writeSync: vi.fn(),
	closeSync: vi.fn(),
}));

// Static imports AFTER vi.mock — gives us typed references to the mocks.
// When the source code does require("node:child_process"), vitest returns
// the same mock object because vi.mock is module-scoped.
import { execFileSync } from "node:child_process";
import { writeSync } from "node:fs";

const mockExecFileSync = vi.mocked(execFileSync);
const mockWriteSync = vi.mocked(writeSync);

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
const ENV_KEYS = ["TERM_PROGRAM", "TMUX", "TMUX_PANE", "KITTY_PID", "TERM", "PI_MODE"];
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

// Helper: import a fresh module instance (bypasses outerTermCache)
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
			const pi = await freshInit();

			await pi.fireOn("agent_end", { messages: [{ role: "assistant", content: "done" }] });
			await pi.fireOn("agent_start");
			vi.advanceTimersByTime(6000);

			// Neither notification path should have been called
			expect(mockExecFileSync).not.toHaveBeenCalledWith(
				"terminal-notifier", expect.anything(), expect.anything(),
			);
			expect(mockExecFileSync).not.toHaveBeenCalledWith(
				"osascript", expect.anything(), expect.anything(),
			);

			vi.useRealTimers();
		});
	});

	describe("notify:disable", () => {
		it("suppresses notifications when disabled", async () => {
			vi.useFakeTimers();
			const pi = await freshInit();
			await pi.fireEvent("notify:disable");

			await triggerNotification(pi);

			expect(mockExecFileSync).not.toHaveBeenCalledWith(
				"terminal-notifier", expect.anything(), expect.anything(),
			);

			vi.useRealTimers();
		});
	});

	describe("RPC mode", () => {
		it("emits JSON to stdout in PI_MODE=rpc and short-circuits", async () => {
			vi.useFakeTimers();
			process.env.PI_MODE = "rpc";
			const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

			const pi = await freshInit();
			await triggerNotification(pi, "hello");

			expect(writeSpy).toHaveBeenCalledWith(
				expect.stringContaining('"type":"desktop_notification"'),
			);
			// Should not fall through to terminal-notifier
			expect(mockExecFileSync).not.toHaveBeenCalledWith(
				"terminal-notifier", expect.anything(), expect.anything(),
			);

			vi.useRealTimers();
		});
	});

	describe("OSC notification path", () => {
		it("writes OSC 9 escape for iTerm2", async () => {
			vi.useFakeTimers();
			process.env.TERM_PROGRAM = "iTerm2";

			const pi = await freshInit();
			await triggerNotification(pi);

			expect(mockWriteSync).toHaveBeenCalledWith(99, expect.stringContaining("\x1b]9;"));

			vi.useRealTimers();
		});

		it("writes OSC 99 base64 for kitty", async () => {
			vi.useFakeTimers();
			process.env.KITTY_PID = "12345";

			const pi = await freshInit();
			await triggerNotification(pi);

			expect(mockWriteSync).toHaveBeenCalledWith(99, expect.stringContaining("\x1b]99;"));

			vi.useRealTimers();
		});

		it("writes OSC 777 for Ghostty", async () => {
			vi.useFakeTimers();
			process.env.TERM_PROGRAM = "Ghostty";

			const pi = await freshInit();
			await triggerNotification(pi);

			expect(mockWriteSync).toHaveBeenCalledWith(99, expect.stringContaining("\x1b]777;notify;"));

			vi.useRealTimers();
		});
	});

	describe("terminal-notifier tmux integration", () => {
		// For these tests: Apple_Terminal + tmux → terminal-notifier path with -execute
		function setupTmuxEnv(paneId?: string, socket = "/tmp/tmux-501/default") {
			process.env.TERM_PROGRAM = "Apple_Terminal";
			process.env.TMUX = `${socket},12345,0`;
			if (paneId) process.env.TMUX_PANE = paneId;

			mockExecFileSync.mockImplementation((cmd: string, args?: readonly string[]) => {
				const a = args as string[] | undefined;
				if (cmd === "tmux" && a?.[0] === "show-environment") return "TERM_PROGRAM=Apple_Terminal";
				if (cmd === "tmux" && a?.[0] === "display-message" && a?.includes("#{client_tty}")) return "/dev/ttys004";
				if (cmd === "tmux" && a?.[0] === "display-message" && a?.includes("#{pane_id}")) return "%0";
				if (cmd === "which") return "/opt/homebrew/bin/tmux";
				if (cmd === "tty") return "/dev/ttys004";
				if (cmd === "terminal-notifier") return "";
				return "";
			});
		}

		it("includes tmux select-window and select-pane using TMUX_PANE", async () => {
			vi.useFakeTimers();
			setupTmuxEnv("%3");

			const pi = await freshInit();
			await triggerNotification(pi);

			const tnCall = mockExecFileSync.mock.calls.find(
				(c: any[]) => c[0] === "terminal-notifier",
			);
			expect(tnCall).toBeDefined();

			const args: string[] = tnCall![1] as string[];
			const executeIdx = args.indexOf("-execute");
			expect(executeIdx).toBeGreaterThan(-1);

			const executeCmd = args[executeIdx + 1];
			expect(executeCmd).toContain("select-window");
			expect(executeCmd).toContain("select-pane");
			expect(executeCmd).toContain("%3");
			expect(executeCmd).toContain("/tmp/tmux-501/default");
			expect(executeCmd).toContain("/opt/homebrew/bin/tmux");

			vi.useRealTimers();
		});

		it("uses TMUX_PANE without calling display-message for pane_id", async () => {
			vi.useFakeTimers();
			setupTmuxEnv("%7");

			const pi = await freshInit();
			await triggerNotification(pi);

			// Verify pane_id display-message was NOT called (TMUX_PANE should suffice)
			const paneIdCall = mockExecFileSync.mock.calls.find(
				(c: any[]) => c[0] === "tmux" && (c[1] as string[])?.includes("#{pane_id}"),
			);
			expect(paneIdCall).toBeUndefined();

			// But the execute command should still have the pane
			const tnCall = mockExecFileSync.mock.calls.find(
				(c: any[]) => c[0] === "terminal-notifier",
			);
			const executeCmd = (tnCall![1] as string[])[(tnCall![1] as string[]).indexOf("-execute") + 1];
			expect(executeCmd).toContain("%7");

			vi.useRealTimers();
		});

		it("falls back to display-message when TMUX_PANE is unset", async () => {
			vi.useFakeTimers();
			setupTmuxEnv(undefined); // No TMUX_PANE

			const pi = await freshInit();
			await triggerNotification(pi);

			// Should have called display-message for pane_id
			const paneIdCall = mockExecFileSync.mock.calls.find(
				(c: any[]) => c[0] === "tmux" && (c[1] as string[])?.includes("#{pane_id}"),
			);
			expect(paneIdCall).toBeDefined();

			const tnCall = mockExecFileSync.mock.calls.find(
				(c: any[]) => c[0] === "terminal-notifier",
			);
			const executeCmd = (tnCall![1] as string[])[(tnCall![1] as string[]).indexOf("-execute") + 1];
			expect(executeCmd).toContain("%0"); // from display-message mock

			vi.useRealTimers();
		});

		it("shell-escapes socket paths with spaces", async () => {
			vi.useFakeTimers();
			setupTmuxEnv("%3", "/tmp/tmux socket/default");

			const pi = await freshInit();
			await triggerNotification(pi);

			const tnCall = mockExecFileSync.mock.calls.find(
				(c: any[]) => c[0] === "terminal-notifier",
			);
			expect(tnCall).toBeDefined();

			const args = tnCall![1] as string[];
			const executeCmd = args[args.indexOf("-execute") + 1];
			// Socket path with space should be single-quoted
			expect(executeCmd).toContain("'/tmp/tmux socket/default'");

			vi.useRealTimers();
		});

		it("omits tmux commands when not in tmux", async () => {
			vi.useFakeTimers();
			process.env.TERM_PROGRAM = "Apple_Terminal";
			// No TMUX env

			mockExecFileSync.mockImplementation((cmd: string) => {
				if (cmd === "tty") return "/dev/ttys004";
				if (cmd === "terminal-notifier") return "";
				return "";
			});

			const pi = await freshInit();
			await triggerNotification(pi);

			const tnCall = mockExecFileSync.mock.calls.find(
				(c: any[]) => c[0] === "terminal-notifier",
			);
			expect(tnCall).toBeDefined();

			const args = tnCall![1] as string[];
			const executeCmd = args[args.indexOf("-execute") + 1];
			expect(executeCmd).toContain("osascript");
			expect(executeCmd).not.toContain("select-window");
			expect(executeCmd).not.toContain("select-pane");

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
			pi.setSessionName("fix tmux bug");
			await triggerNotification(pi);

			const parsed = JSON.parse(writeSpy.mock.calls[0][0] as string);
			expect(parsed.title).toBe("π: fix tmux bug");

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
