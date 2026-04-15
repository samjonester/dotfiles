import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  readSessionJSONL,
  writeSessionFile,
  extractPreview,
  countMessages,
  getUserEmail,
  getProjectName,
  getGitBranch,
  getGitRepo,
  getGitBranchUrl,
  getSessionStats,
  getWorldAreaAndSlice,
  matchSlice,
} from "./session-io.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import * as child_process from "child_process";

vi.mock("fs");
vi.mock("child_process");
vi.mock("crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof crypto>();
  return { ...actual, randomUUID: vi.fn(() => "test-uuid-1234") };
});

const mockExecSync = vi.mocked(child_process.execSync);

const mockFs = vi.mocked(fs);

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.PI_CODING_AGENT_DIR;
});

// ── readSessionJSONL ─────────────────────────────────────────────

describe("readSessionJSONL", () => {
  it("reads and trims trailing whitespace", () => {
    mockFs.readFileSync.mockReturnValue('{"type":"session"}\n{"type":"message"}\n\n');
    const result = readSessionJSONL("/some/path.jsonl");
    expect(result).toBe('{"type":"session"}\n{"type":"message"}');
    expect(mockFs.readFileSync).toHaveBeenCalledWith("/some/path.jsonl", "utf-8");
  });
});

// ── writeSessionFile ─────────────────────────────────────────────

describe("writeSessionFile", () => {
  it("writes to the default sessions dir", () => {
    mockFs.mkdirSync.mockReturnValue(undefined);
    mockFs.writeFileSync.mockReturnValue(undefined);

    const result = writeSessionFile('{"type":"session"}', "/Users/me/project");

    expect(mockFs.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining("--Users-me-project--"),
      { recursive: true },
    );
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("test-uuid-1234.jsonl"),
      '{"type":"session"}\n',
      "utf-8",
    );
    expect(result).toContain("test-uuid-1234.jsonl");
  });

  it("respects PI_CODING_AGENT_DIR env var", () => {
    process.env.PI_CODING_AGENT_DIR = "/custom/agent";
    mockFs.mkdirSync.mockReturnValue(undefined);
    mockFs.writeFileSync.mockReturnValue(undefined);

    const result = writeSessionFile('{"line":1}', "/project");

    expect(mockFs.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining("/custom/agent/sessions/"),
      { recursive: true },
    );
    expect(result).toContain("/custom/agent/sessions/");
  });
});

// ── extractPreview ───────────────────────────────────────────────

describe("extractPreview", () => {
  it("extracts string content from first user message", () => {
    const jsonl = [
      '{"type":"session","version":3}',
      '{"type":"message","message":{"role":"user","content":"Hello world"}}',
    ].join("\n");
    expect(extractPreview(jsonl)).toBe("Hello world");
  });

  it("extracts text block from content array", () => {
    const jsonl = [
      '{"type":"session"}',
      '{"type":"message","message":{"role":"user","content":[{"type":"text","text":"Array hello"}]}}',
    ].join("\n");
    expect(extractPreview(jsonl)).toBe("Array hello");
  });

  it("skips non-text blocks in content array", () => {
    const jsonl = [
      '{"type":"message","message":{"role":"user","content":[{"type":"image","data":"abc"},{"type":"text","text":"after image"}]}}',
    ].join("\n");
    expect(extractPreview(jsonl)).toBe("after image");
  });

  it("returns empty string when no user messages", () => {
    const jsonl = '{"type":"session"}\n{"type":"message","message":{"role":"assistant","content":"hi"}}';
    expect(extractPreview(jsonl)).toBe("");
  });

  it("truncates to 120 chars for string content", () => {
    const long = "x".repeat(200);
    const jsonl = `{"type":"message","message":{"role":"user","content":"${long}"}}`;
    expect(extractPreview(jsonl)).toHaveLength(120);
  });

  it("truncates to 120 chars for array content", () => {
    const long = "y".repeat(200);
    const jsonl = `{"type":"message","message":{"role":"user","content":[{"type":"text","text":"${long}"}]}}`;
    expect(extractPreview(jsonl)).toHaveLength(120);
  });

  it("skips malformed JSON lines", () => {
    const jsonl = "not json\n" + '{"type":"message","message":{"role":"user","content":"ok"}}';
    expect(extractPreview(jsonl)).toBe("ok");
  });

  it("returns empty for empty input", () => {
    expect(extractPreview("")).toBe("");
  });

  it("returns empty for only blank lines", () => {
    expect(extractPreview("  \n  \n  ")).toBe("");
  });

  it("returns empty when content array has no text blocks", () => {
    const jsonl = '{"type":"message","message":{"role":"user","content":[{"type":"image","data":"x"}]}}';
    expect(extractPreview(jsonl)).toBe("");
  });

  it("returns empty when content is neither string nor array", () => {
    const jsonl = '{"type":"message","message":{"role":"user","content":42}}';
    expect(extractPreview(jsonl)).toBe("");
  });
});

// ── countMessages ────────────────────────────────────────────────

describe("countMessages", () => {
  it("counts user and assistant messages", () => {
    const jsonl = [
      '{"type":"session"}',
      '{"type":"message","message":{"role":"user","content":"hi"}}',
      '{"type":"message","message":{"role":"assistant","content":"hello"}}',
      '{"type":"message","message":{"role":"toolResult","toolName":"bash"}}',
    ].join("\n");
    expect(countMessages(jsonl)).toBe(2);
  });

  it("returns 0 for empty input", () => {
    expect(countMessages("")).toBe(0);
  });

  it("returns 0 for blank lines only", () => {
    expect(countMessages("  \n  ")).toBe(0);
  });

  it("skips malformed JSON lines", () => {
    const jsonl = "bad json\n" + '{"type":"message","message":{"role":"user","content":"ok"}}';
    expect(countMessages(jsonl)).toBe(1);
  });

  it("skips non-message entries", () => {
    const jsonl = [
      '{"type":"session"}',
      '{"type":"compaction","summary":"stuff"}',
      '{"type":"custom","customType":"ext","data":{}}',
    ].join("\n");
    expect(countMessages(jsonl)).toBe(0);
  });
});

// ── getUserEmail ─────────────────────────────────────────────────

describe("getUserEmail", () => {
  it("returns email from git config", () => {
    mockExecSync.mockReturnValue("me@shopify.com\n");
    expect(getUserEmail()).toBe("me@shopify.com");
  });

  it("returns 'unknown' when git config fails", () => {
    mockExecSync.mockImplementation(() => { throw new Error("no git"); });
    expect(getUserEmail()).toBe("unknown");
  });
});

// ── getProjectName ───────────────────────────────────────────────

describe("getProjectName", () => {
  it("returns basename of cwd", () => {
    expect(getProjectName("/Users/me/src/cool-project")).toBe("cool-project");
  });

  it("returns 'unknown' for empty string", () => {
    expect(getProjectName("")).toBe("unknown");
  });
});

// ── getGitBranch ─────────────────────────────────────────────────

describe("getGitBranch", () => {
  it("returns the current branch", () => {
    mockExecSync.mockReturnValue("my-feature\n");
    expect(getGitBranch()).toBe("my-feature");
  });

  it("returns empty string when git fails", () => {
    mockExecSync.mockImplementation(() => { throw new Error("not a repo"); });
    expect(getGitBranch()).toBe("");
  });
});

// ── getGitRepo ───────────────────────────────────────────────────

describe("getGitRepo", () => {
  it("converts SSH URL to HTTPS", () => {
    mockExecSync.mockReturnValue("git@github.com:Shopify/cool-repo.git\n");
    expect(getGitRepo()).toBe("https://github.com/Shopify/cool-repo");
  });

  it("converts SSH URL without .git suffix", () => {
    mockExecSync.mockReturnValue("git@github.com:Shopify/cool-repo\n");
    expect(getGitRepo()).toBe("https://github.com/Shopify/cool-repo");
  });

  it("strips .git from HTTPS URL", () => {
    mockExecSync.mockReturnValue("https://github.com/Shopify/cool-repo.git\n");
    expect(getGitRepo()).toBe("https://github.com/Shopify/cool-repo");
  });

  it("returns HTTPS URL as-is when no .git suffix", () => {
    mockExecSync.mockReturnValue("https://github.com/Shopify/cool-repo\n");
    expect(getGitRepo()).toBe("https://github.com/Shopify/cool-repo");
  });

  it("returns empty string when git fails", () => {
    mockExecSync.mockImplementation(() => { throw new Error("no remote"); });
    expect(getGitRepo()).toBe("");
  });
});

// ── getGitBranchUrl ──────────────────────────────────────────────

describe("getGitBranchUrl", () => {
  it("constructs branch URL from repo and branch", () => {
    mockExecSync
      .mockReturnValueOnce("git@github.com:Shopify/cool-repo.git\n")
      .mockReturnValueOnce("my-feature\n");
    expect(getGitBranchUrl()).toBe("https://github.com/Shopify/cool-repo/tree/my-feature");
  });

  it("returns empty string when repo is empty", () => {
    mockExecSync
      .mockImplementationOnce(() => { throw new Error("no remote"); })
      .mockReturnValueOnce("main\n");
    expect(getGitBranchUrl()).toBe("");
  });

  it("returns empty string when branch is empty", () => {
    mockExecSync
      .mockReturnValueOnce("git@github.com:Shopify/repo.git\n")
      .mockImplementationOnce(() => { throw new Error("detached"); });
    expect(getGitBranchUrl()).toBe("");
  });
});

// ── getSessionStats ──────────────────────────────────────────────

describe("getSessionStats", () => {
  it("aggregates usage across assistant messages", () => {
    const jsonl = [
      '{"type":"message","message":{"role":"assistant","model":"claude-sonnet","provider":"anthropic","usage":{"input":100,"output":50,"cacheRead":10,"cacheWrite":5,"totalTokens":165,"cost":{"input":0.001,"output":0.002,"cacheRead":0.0001,"cacheWrite":0.0001,"total":0.0032}}}}',
      '{"type":"message","message":{"role":"assistant","model":"claude-sonnet","provider":"anthropic","usage":{"input":200,"output":80,"cacheRead":20,"cacheWrite":10,"totalTokens":310,"cost":{"input":0.002,"output":0.004,"cacheRead":0.0002,"cacheWrite":0.0002,"total":0.0064}}}}',
    ].join("\n");

    const stats = getSessionStats(jsonl);
    expect(stats.inputTokens).toBe(300);
    expect(stats.outputTokens).toBe(130);
    expect(stats.cacheReadTokens).toBe(30);
    expect(stats.cacheWriteTokens).toBe(15);
    expect(stats.totalTokens).toBe(475);
    expect(stats.totalCost).toBe(0.0096);
    expect(stats.models).toEqual(["anthropic/claude-sonnet"]);
  });

  it("collects multiple unique models", () => {
    const jsonl = [
      '{"type":"message","message":{"role":"assistant","model":"claude-sonnet","provider":"anthropic","usage":{"input":10,"output":5,"cacheRead":0,"cacheWrite":0,"totalTokens":15,"cost":{"total":0.001}}}}',
      '{"type":"message","message":{"role":"assistant","model":"gpt-4o","provider":"openai","usage":{"input":20,"output":10,"cacheRead":0,"cacheWrite":0,"totalTokens":30,"cost":{"total":0.002}}}}',
      '{"type":"message","message":{"role":"assistant","model":"claude-sonnet","provider":"anthropic","usage":{"input":10,"output":5,"cacheRead":0,"cacheWrite":0,"totalTokens":15,"cost":{"total":0.001}}}}',
    ].join("\n");

    const stats = getSessionStats(jsonl);
    expect(stats.models).toEqual(["anthropic/claude-sonnet", "openai/gpt-4o"]);
  });

  it("handles model without provider", () => {
    const jsonl = '{"type":"message","message":{"role":"assistant","model":"some-model","usage":{"input":10,"output":5,"cacheRead":0,"cacheWrite":0,"totalTokens":15,"cost":{"total":0.001}}}}';
    const stats = getSessionStats(jsonl);
    expect(stats.models).toEqual(["some-model"]);
  });

  it("handles assistant message without usage", () => {
    const jsonl = '{"type":"message","message":{"role":"assistant","model":"x","content":[{"type":"text","text":"hi"}]}}';
    const stats = getSessionStats(jsonl);
    expect(stats.totalTokens).toBe(0);
    expect(stats.totalCost).toBe(0);
    expect(stats.models).toEqual(["x"]);
  });

  it("handles usage with missing cost", () => {
    const jsonl = '{"type":"message","message":{"role":"assistant","model":"x","usage":{"input":10,"output":5,"totalTokens":15}}}';
    const stats = getSessionStats(jsonl);
    expect(stats.inputTokens).toBe(10);
    expect(stats.totalCost).toBe(0);
  });

  it("skips non-assistant messages", () => {
    const jsonl = [
      '{"type":"message","message":{"role":"user","content":"hi"}}',
      '{"type":"message","message":{"role":"toolResult","toolName":"bash"}}',
      '{"type":"session"}',
    ].join("\n");
    const stats = getSessionStats(jsonl);
    expect(stats.totalTokens).toBe(0);
    expect(stats.models).toEqual([]);
  });

  it("returns zeros for empty input", () => {
    const stats = getSessionStats("");
    expect(stats.totalTokens).toBe(0);
    expect(stats.totalCost).toBe(0);
    expect(stats.models).toEqual([]);
  });

  it("skips malformed lines", () => {
    const jsonl = "not json\n" + '{"type":"message","message":{"role":"assistant","model":"x","usage":{"input":10,"output":5,"cacheRead":0,"cacheWrite":0,"totalTokens":15,"cost":{"total":0.001}}}}';
    const stats = getSessionStats(jsonl);
    expect(stats.totalTokens).toBe(15);
  });

  it("skips blank lines", () => {
    const jsonl = "  \n  \n" + '{"type":"message","message":{"role":"assistant","model":"x","usage":{"input":1,"output":1,"cacheRead":0,"cacheWrite":0,"totalTokens":2,"cost":{"total":0.0001}}}}';
    const stats = getSessionStats(jsonl);
    expect(stats.totalTokens).toBe(2);
  });

  it("rounds cost to avoid float noise", () => {
    const jsonl = [
      '{"type":"message","message":{"role":"assistant","model":"x","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"total":0.1}}}}',
      '{"type":"message","message":{"role":"assistant","model":"x","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"total":0.2}}}}',
      '{"type":"message","message":{"role":"assistant","model":"x","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"total":0.3}}}}',
    ].join("\n");
    const stats = getSessionStats(jsonl);
    // 0.1 + 0.2 + 0.3 would be 0.6000000000000001 without rounding
    expect(stats.totalCost).toBe(0.6);
  });

  it("handles assistant message without model", () => {
    const jsonl = '{"type":"message","message":{"role":"assistant","usage":{"input":10,"output":5,"cacheRead":0,"cacheWrite":0,"totalTokens":15,"cost":{"total":0.001}}}}';
    const stats = getSessionStats(jsonl);
    expect(stats.totalTokens).toBe(15);
    expect(stats.models).toEqual([]);
  });
});

// ── matchSlice ───────────────────────────────────────────────────

describe("matchSlice", () => {
  const slicesYml = `---
version: 2
slices:
- name: checkout-core
  id: S-abc123
  default: true
  slack_channels:
  - "#checkout-core"
  stewards:
  - 1234
  paths:
  - components/checkouts/core/**/*
  - components/checkouts/one/**/*
- name: checkout-payments
  id: S-def456
  slack_channels:
  - "#checkout-payments"
  stewards:
  - 5678
  paths:
  - components/checkouts/core/app/models/cart_next_payment.rb
  - components/checkouts/shopify_pay/**/*
- name: admin
  id: S-ghi789
  slack_channels:
  - "#admin"
  stewards:
  - 9999
  paths:
  - components/platform/admin/**/*
`;

  it("matches the most specific path", () => {
    expect(matchSlice(slicesYml, "components/checkouts/core/app/models/cart_next_payment.rb"))
      .toBe("checkout-payments");
  });

  it("matches a broader path when no specific match", () => {
    expect(matchSlice(slicesYml, "components/checkouts/core/app/models/something_else.rb"))
      .toBe("checkout-core");
  });

  it("matches wildcard paths", () => {
    expect(matchSlice(slicesYml, "components/checkouts/shopify_pay/app/service.rb"))
      .toBe("checkout-payments");
  });

  it("falls back to default slice when no path matches", () => {
    expect(matchSlice(slicesYml, "some/random/path.rb"))
      .toBe("checkout-core");
  });

  it("returns empty string when no match and no default", () => {
    const noDefault = `---
slices:
- name: only-one
  id: S-123
  paths:
  - specific/path/**/*
`;
    expect(matchSlice(noDefault, "other/path.rb")).toBe("");
  });

  it("returns empty string for empty slices yml", () => {
    expect(matchSlice("", "any/path")).toBe("");
  });

  it("stops parsing paths when a non-path key follows", () => {
    const yml = `---
slices:
- name: my-slice
  paths:
  - components/foo/**/*
  stewards:
  - 1234
  reviewers:
  - 5678
`;
    expect(matchSlice(yml, "components/foo/bar.rb")).toBe("my-slice");
  });
});

// ── getWorldAreaAndSlice ─────────────────────────────────────────

describe("getWorldAreaAndSlice", () => {
  it("finds area from cwd inside areas/", () => {
    mockExecSync.mockReturnValueOnce("/Users/me/src/shop/world\n");
    const slicesContent = "---\nslices:\n- name: my-slice\n  default: true\n";
    const enoent = () => { throw new Error("ENOENT"); };
    // cwd = areas/core/shopify/components/checkout
    // walk: checkout/slices.yml → no, components/slices.yml → no, shopify/slices.yml → yes
    mockFs.readFileSync
      .mockImplementationOnce(enoent)       // checkout/slices.yml
      .mockImplementationOnce(enoent)       // components/slices.yml
      .mockReturnValueOnce(slicesContent)   // shopify/slices.yml (found!)
      .mockReturnValueOnce(slicesContent);  // re-read for matchSlice

    const result = getWorldAreaAndSlice("/Users/me/src/shop/world/areas/core/shopify/components/checkout");
    expect(result.area).toBe("areas/core/shopify");
    expect(result.slice).toBe("my-slice");
  });

  it("finds project in libraries/", () => {
    mockExecSync.mockReturnValueOnce("/Users/me/src/shop/world\n");
    const slicesContent = "---\nslices:\n- name: analytics\n  default: true\n";
    const enoent = () => { throw new Error("ENOENT"); };
    // cwd = libraries/javascript/jest-analytics/src
    // walk: src/slices.yml → no, jest-analytics/slices.yml → yes
    mockFs.readFileSync
      .mockImplementationOnce(enoent)       // src/slices.yml
      .mockReturnValueOnce(slicesContent)   // jest-analytics/slices.yml
      .mockReturnValueOnce(slicesContent);

    const result = getWorldAreaAndSlice("/Users/me/src/shop/world/libraries/javascript/jest-analytics/src");
    expect(result.area).toBe("libraries/javascript/jest-analytics");
    expect(result.slice).toBe("analytics");
  });

  it("finds project in system/", () => {
    mockExecSync.mockReturnValueOnce("/Users/me/src/shop/world\n");
    const slicesContent = "---\nslices:\n- name: windex-core\n  default: true\n";
    // cwd = system/windex — slices.yml is right here
    mockFs.readFileSync
      .mockReturnValueOnce(slicesContent)
      .mockReturnValueOnce(slicesContent);

    const result = getWorldAreaAndSlice("/Users/me/src/shop/world/system/windex");
    expect(result.area).toBe("system/windex");
    expect(result.slice).toBe("windex-core");
  });

  it("finds nested project under system/river/riverd", () => {
    mockExecSync.mockReturnValueOnce("/Users/me/src/shop/world\n");
    const slicesContent = "---\nslices:\n- name: riverd-core\n  default: true\n";
    const enoent = () => { throw new Error("ENOENT"); };
    // cwd = system/river/riverd/src/handlers
    // walk: handlers → no, src → no, riverd → yes
    mockFs.readFileSync
      .mockImplementationOnce(enoent)
      .mockImplementationOnce(enoent)
      .mockReturnValueOnce(slicesContent)
      .mockReturnValueOnce(slicesContent);

    const result = getWorldAreaAndSlice("/Users/me/src/shop/world/system/river/riverd/src/handlers");
    expect(result.area).toBe("system/river/riverd");
    expect(result.slice).toBe("riverd-core");
  });

  it("returns empty strings when no slices.yml found walking up", () => {
    mockExecSync.mockReturnValueOnce("/Users/me/src/shop/world\n");
    mockFs.readFileSync.mockImplementation(() => { throw new Error("ENOENT"); });

    const result = getWorldAreaAndSlice("/Users/me/src/shop/world/some/random/path");
    expect(result).toEqual({ area: "", slice: "" });
  });

  it("returns empty strings when not in a git repo", () => {
    mockExecSync.mockImplementation(() => { throw new Error("not a repo"); });

    const result = getWorldAreaAndSlice("/tmp/random");
    expect(result).toEqual({ area: "", slice: "" });
  });

  it("returns empty when cwd does not start with repo root", () => {
    mockExecSync.mockReturnValueOnce("/some/other/root\n");

    const result = getWorldAreaAndSlice("/Users/me/different/path");
    expect(result).toEqual({ area: "", slice: "" });
  });

  it("returns empty when cwd equals repo root", () => {
    mockExecSync.mockReturnValueOnce("/Users/me/src/shop/world\n");

    const result = getWorldAreaAndSlice("/Users/me/src/shop/world");
    expect(result).toEqual({ area: "", slice: "" });
  });
});
