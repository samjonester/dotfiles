/**
 * Tests for shell-mode index.ts logic.
 *
 * The extension registers a user_bash event handler. We can't easily mock
 * the pi extension API, but we can test the handler's return values by
 * simulating the event/ctx objects for the branches we care about.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the pty module — keep truncateOutput real, mock runInPty
vi.mock("./pty.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./pty.js")>();
	return {
		...actual,
		runInPty: vi.fn(() => ({ exitCode: 0, rawOutput: "", cleanOutput: "", usedAltScreen: false, truncated: false })),
	};
});

import { runInPty } from "./pty.js";

let registeredHandler: ((event: any, ctx: any) => Promise<any>) | null = null;

const mockPi = {
	on: (eventName: string, handler: any) => {
		if (eventName === "user_bash") {
			registeredHandler = handler;
		}
	},
};

function makeCtx(hasUI = true) {
	return {
		hasUI,
		ui: {
			custom: async <T>(factory: (tui: any, theme: any, kb: any, done: (v: T) => void) => any): Promise<T> => {
				return new Promise<T>((resolve) => {
					factory(
						{ stop: () => {}, start: () => {}, requestRender: () => {} },
						{},
						{},
						resolve,
					);
				});
			},
		},
	};
}

describe("shell-mode handler", () => {
	const savedHook = globalThis.__piBgRunHook;

	beforeEach(async () => {
		registeredHandler = null;
		globalThis.__piBgRunHook = undefined;
		// Dynamic import to register handler fresh
		const mod = await import("./index.js");
		mod.default(mockPi as any);
	});

	afterEach(() => {
		globalThis.__piBgRunHook = savedHook;
	});

	it("returns undefined for normal commands (passthrough)", async () => {
		const result = await registeredHandler!({ command: "ls -la" }, makeCtx());
		expect(result).toBeUndefined();
	});

	it("returns error when bg hook is not available", async () => {
		const result = await registeredHandler!({ command: "& dev up" }, makeCtx());
		expect(result.result.output).toContain("requires the background-jobs extension");
		expect(result.result.exitCode).toBe(1);
	});

	it("returns success for bg command with hook", async () => {
		globalThis.__piBgRunHook = async () => ({
			jobId: 1,
			pid: 12345,
			stdoutPath: "/tmp/stdout.log",
			stderrPath: "/tmp/stderr.log",
		});
		const result = await registeredHandler!({ command: "& sleep 10" }, makeCtx());
		expect(result.result.output).toContain("Started background job #1");
		expect(result.result.output).toContain("pid 12345");
		expect(result.result.exitCode).toBe(0);
	});

	it("returns error for bg command when hook returns error", async () => {
		globalThis.__piBgRunHook = async () => ({
			jobId: -1,
			pid: null,
			stdoutPath: "",
			stderrPath: "",
			error: "too many jobs",
		});
		const result = await registeredHandler!({ command: "& sleep 10" }, makeCtx());
		expect(result.result.output).toContain("failed: too many jobs");
		expect(result.result.exitCode).toBe(1);
	});

	it("returns error for interactive/fullscreen without UI", async () => {
		const result = await registeredHandler!({ command: "i some-command" }, makeCtx(false));
		expect(result.result.output).toContain("interactive commands require TUI");
		expect(result.result.exitCode).toBe(1);
	});

	it("passes skipReview: true to bg hook", async () => {
		let receivedOptions: any;
		globalThis.__piBgRunHook = async (_cmd, _cwd, opts) => {
			receivedOptions = opts;
			return { jobId: 1, pid: 1, stdoutPath: "", stderrPath: "" };
		};
		await registeredHandler!({ command: "& echo test" }, makeCtx());
		expect(receivedOptions).toEqual({ skipReview: true });
	});

	it("runs interactive command and returns captured output", async () => {
		vi.mocked(runInPty).mockReturnValueOnce({ exitCode: 0, rawOutput: "", cleanOutput: "hello world", usedAltScreen: false, truncated: false });
		const result = await registeredHandler!({ command: "i some-command" }, makeCtx());
		expect(result.result.output).toContain("hello world");
		expect(result.result.exitCode).toBe(0);
	});

	it("returns no-output message when cleanOutput is empty", async () => {
		vi.mocked(runInPty).mockReturnValueOnce({ exitCode: 0, rawOutput: "", cleanOutput: "", usedAltScreen: false, truncated: false });
		const result = await registeredHandler!({ command: "i some-command" }, makeCtx());
		expect(result.result.output).toContain("no output");
	});

	it("runs interactive command and returns non-zero exit code", async () => {
		vi.mocked(runInPty).mockReturnValueOnce({ exitCode: 42, rawOutput: "", cleanOutput: "error msg", usedAltScreen: false, truncated: false });
		const result = await registeredHandler!({ command: "i failing-command" }, makeCtx());
		expect(result.result.output).toContain("error msg");
		expect(result.result.exitCode).toBe(42);
	});

	it("alt-screen TUI suppresses captured output and returns status line", async () => {
		// Alt-screen output is full of cursor-positioning escapes that don't survive
		// stripping cleanly. We deliberately discard cleanOutput and return a status line.
		vi.mocked(runInPty).mockReturnValueOnce({ exitCode: 0, rawOutput: "", cleanOutput: "fullscreen output here", usedAltScreen: true, truncated: false });
		const result = await registeredHandler!({ command: "f some-tui" }, makeCtx());
		expect(result.result.output).not.toContain("fullscreen output here");
		expect(result.result.output).toMatch(/fullscreen command exited cleanly/);
		expect(result.result.exitCode).toBe(0);
	});

	it("alt-screen TUI with non-zero exit reports the code", async () => {
		vi.mocked(runInPty).mockReturnValueOnce({ exitCode: 130, rawOutput: "", cleanOutput: "", usedAltScreen: true, truncated: false });
		const result = await registeredHandler!({ command: "f some-tui" }, makeCtx());
		expect(result.result.output).toMatch(/fullscreen command exited with code 130/);
		expect(result.result.exitCode).toBe(130);
	});

	it("fullscreen with non-zero exit and no output", async () => {
		vi.mocked(runInPty).mockReturnValueOnce({ exitCode: 1, rawOutput: "", cleanOutput: "", usedAltScreen: false, truncated: false });
		const result = await registeredHandler!({ command: "f failing-tui" }, makeCtx());
		expect(result.result.output).toContain("exited with code 1");
		expect(result.result.exitCode).toBe(1);
	});

	it("fullscreen handles null ptyResult from ctx.ui.custom", async () => {
		// ctx.ui.custom can return undefined in RPC mode
		const ctx = makeCtx();
		ctx.ui.custom = async () => undefined as any;
		const result = await registeredHandler!({ command: "f some-tui" }, ctx);
		expect(result.result.exitCode).toBe(1);
	});

	it("handles null exit code with output from PTY", async () => {
		vi.mocked(runInPty).mockReturnValueOnce({ exitCode: null, rawOutput: "", cleanOutput: "some output", usedAltScreen: false, truncated: false });
		const result = await registeredHandler!({ command: "i cmd" }, makeCtx());
		expect(result.result.exitCode).toBe(1);
		expect(result.result.output).toContain("some output");
	});

	it("handles null exit code without output from PTY", async () => {
		vi.mocked(runInPty).mockReturnValueOnce({ exitCode: null, rawOutput: "", cleanOutput: "", usedAltScreen: false, truncated: false });
		const result = await registeredHandler!({ command: "i hung-command" }, makeCtx());
		expect(result.result.exitCode).toBe(1);
	});

	it("truncates very long output and sets truncated flag", async () => {
		const longOutput = "x".repeat(20000);
		vi.mocked(runInPty).mockReturnValueOnce({ exitCode: 0, rawOutput: "", cleanOutput: longOutput, usedAltScreen: false, truncated: false });
		const result = await registeredHandler!({ command: "i verbose-cmd" }, makeCtx());
		expect(result.result.output.length).toBeLessThan(11000);
		expect(result.result.output).toContain("truncated");
		expect(result.result.truncated).toBe(true);
	});

	it("calls runInPty for interactive commands", async () => {
		vi.mocked(runInPty).mockReturnValueOnce({ exitCode: 0, rawOutput: "", cleanOutput: "test", usedAltScreen: false, truncated: false });
		await registeredHandler!({ command: "i echo test" }, makeCtx());
		expect(vi.mocked(runInPty)).toHaveBeenCalled();
	});

	it("shows ? when bg hook returns null pid", async () => {
		globalThis.__piBgRunHook = async () => ({
			jobId: 3, pid: null, stdoutPath: "/tmp/out", stderrPath: "/tmp/err",
		});
		const result = await registeredHandler!({ command: "& some-cmd" }, makeCtx());
		expect(result.result.output).toContain("pid ?");
	});

	it("handles trailing & as background mode", async () => {
		globalThis.__piBgRunHook = async () => ({
			jobId: 2, pid: 999, stdoutPath: "/tmp/out", stderrPath: "/tmp/err",
		});
		const result = await registeredHandler!({ command: "dev up &" }, makeCtx());
		expect(result.result.output).toContain("Started background job #2");
	});
});
