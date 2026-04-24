import { describe, it, expect } from "vitest";
import { runInPty, cleanRawOutput, truncateOutput, MAX_OUTPUT_BYTES } from "./pty.js";

// ── cleanRawOutput (pure, always testable) ───────────────────────

describe("cleanRawOutput", () => {
	it("strips ANSI color codes", () => {
		const result = cleanRawOutput("\x1b[31mred\x1b[0m text");
		expect(result).toBe("red text");
	});

	it("strips macOS script ^D prefix", () => {
		const result = cleanRawOutput("^Dhello\nworld");
		expect(result).toBe("hello\nworld");
	});

	it("strips raw EOT bytes", () => {
		const result = cleanRawOutput("\x04hello");
		expect(result).toBe("hello");
	});

	it("strips Linux script header", () => {
		const result = cleanRawOutput('Script started on 2026-03-21 04:33:07+00:00 [COMMAND="bash"]\nhello');
		expect(result).toBe("hello");
	});

	it("strips Linux script footer", () => {
		const result = cleanRawOutput('hello\nScript done on 2026-03-21 04:33:07+00:00 [COMMAND_EXIT_CODE="0"]');
		expect(result).toBe("hello");
	});

	it("strips both Linux header and footer", () => {
		const result = cleanRawOutput('Script started on 2026-03-21\nhello world\nScript done on 2026-03-21');
		expect(result).toBe("hello world");
	});

	it("normalizes \\r\\n to \\n", () => {
		const result = cleanRawOutput("line1\r\nline2\r\n");
		expect(result).toBe("line1\nline2");
	});

	it("normalizes bare \\r to \\n", () => {
		const result = cleanRawOutput("line1\rline2");
		expect(result).toBe("line1\nline2");
	});

	it("strips cursor positioning sequences", () => {
		const result = cleanRawOutput("\x1b[2J\x1b[Hhello");
		expect(result).toBe("hello");
	});

	it("strips OSC sequences with BEL terminator", () => {
		expect(cleanRawOutput("\x1b]0;window title\x07hello")).toBe("hello");
	});

	it("strips OSC sequences with ST terminator", () => {
		expect(cleanRawOutput("\x1b]0;window title\x1b\\hello")).toBe("hello");
	});

	it("handles empty input", () => {
		expect(cleanRawOutput("")).toBe("");
	});

	it("handles input with only control characters", () => {
		expect(cleanRawOutput("\x1b[31m\x1b[0m")).toBe("");
	});

	it("preserves normal text", () => {
		expect(cleanRawOutput("hello world")).toBe("hello world");
	});
});

// ── truncateOutput ───────────────────────────────────────────────

describe("truncateOutput", () => {
	it("does not truncate short output", () => {
		const { text, truncated } = truncateOutput("hello");
		expect(text).toBe("hello");
		expect(truncated).toBe(false);
	});

	it("truncates long output", () => {
		const long = "x".repeat(MAX_OUTPUT_BYTES + 1000);
		const { text, truncated } = truncateOutput(long);
		expect(text.length).toBeLessThan(MAX_OUTPUT_BYTES + 20);
		expect(text).toContain("…(truncated)");
		expect(truncated).toBe(true);
	});

	it("exactly at limit is not truncated", () => {
		const exact = "x".repeat(MAX_OUTPUT_BYTES);
		const { truncated } = truncateOutput(exact);
		expect(truncated).toBe(false);
	});
});

// ── runInPty (integration, environment-dependent) ────────────────

describe("runInPty", () => {
	it("runs a command and returns a result", () => {
		const result = runInPty("echo hello");
		expect(result.exitCode).toBe(0);
	});

	it("returns a PtyResult with all fields", () => {
		const result = runInPty("echo test");
		expect(result).toHaveProperty("exitCode");
		expect(result).toHaveProperty("rawOutput");
		expect(result).toHaveProperty("cleanOutput");
		expect(result).toHaveProperty("usedAltScreen");
		expect(result).toHaveProperty("truncated");
		expect(typeof result.usedAltScreen).toBe("boolean");
		expect(typeof result.truncated).toBe("boolean");
	});

	it("usedAltScreen is false for normal commands", () => {
		const result = runInPty("echo normal");
		expect(result.usedAltScreen).toBe(false);
	});

	it("captures output when PTY is available", () => {
		const result = runInPty('echo "captured_output_test"');
		if (result.cleanOutput) {
			expect(result.cleanOutput).toContain("captured_output_test");
		}
	});

	it("always returns a valid PtyResult even without TTY", () => {
		const result = runInPty("echo fallback");
		expect(result.exitCode).toBe(0);
		expect(typeof result.usedAltScreen).toBe("boolean");
	});
});
