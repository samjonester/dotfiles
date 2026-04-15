import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  uploadSessionFile,
  downloadSessionFile,
  createDumpRecord,
  listDumpRecords,
} from "./quick-fs.js";

vi.mock("./quick-auth.js", () => ({
  getIAPToken: vi.fn(async () => "mock-iap-token"),
}));

vi.mock("crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("crypto")>();
  return { ...actual, randomUUID: vi.fn(() => "aabbccdd-1122-3344-5566-778899001122") };
});

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  vi.clearAllMocks();
});

// ── uploadSessionFile ────────────────────────────────────────────

describe("uploadSessionFile", () => {
  it("uploads JSONL and returns uuid + url", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        files: [{ fullUrl: "https://pi-dump.quick.shopify.io/files/aabbccdd1122.jsonl" }],
      }),
    });

    const result = await uploadSessionFile('{"line":1}');

    expect(result.uuid).toBe("aabbccdd1122");
    expect(result.url).toBe("https://pi-dump.quick.shopify.io/files/aabbccdd1122.jsonl");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://pi-dump.quick.shopify.io/api/fs/upload?strategy=original");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe("Bearer mock-iap-token");
    expect(opts.body).toContain('filename="aabbccdd1122.jsonl"');
    expect(opts.body).toContain('{"line":1}');
  });

  it("falls back to constructed URL when files[0].fullUrl is missing", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ files: [{ url: "/files/aabbccdd1122.jsonl" }] }),
    });

    const result = await uploadSessionFile("data");
    expect(result.url).toBe("https://pi-dump.quick.shopify.io/files/aabbccdd1122.jsonl");
  });

  it("falls back when files array is empty", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ files: [] }),
    });

    const result = await uploadSessionFile("data");
    expect(result.url).toBe("https://pi-dump.quick.shopify.io/files/aabbccdd1122.jsonl");
  });

  it("falls back when files is undefined", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const result = await uploadSessionFile("data");
    expect(result.url).toBe("https://pi-dump.quick.shopify.io/files/aabbccdd1122.jsonl");
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "Internal error",
    });

    await expect(uploadSessionFile("data")).rejects.toThrow(
      "Upload failed (500): Internal error",
    );
  });
});

// ── downloadSessionFile ──────────────────────────────────────────

describe("downloadSessionFile", () => {
  it("downloads JSONL by uuid", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '{"type":"session"}\n{"type":"message"}',
    });

    const result = await downloadSessionFile("abc123");

    expect(result).toBe('{"type":"session"}\n{"type":"message"}');
    expect(mockFetch).toHaveBeenCalledWith(
      "https://pi-dump.quick.shopify.io/files/abc123.jsonl",
      { headers: { Authorization: "Bearer mock-iap-token" } },
    );
  });

  it("throws descriptive error on 404", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    await expect(downloadSessionFile("missing")).rejects.toThrow(
      'Session "missing" not found on pi-dump.quick.shopify.io',
    );
  });

  it("throws on other HTTP errors", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    });

    await expect(downloadSessionFile("abc")).rejects.toThrow(
      "Download failed (403): Forbidden",
    );
  });
});

// ── createDumpRecord ─────────────────────────────────────────────

describe("createDumpRecord", () => {
  it("posts record to the dumps collection", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    await createDumpRecord({
      uuid: "abc123",
      owner: "me@shopify.com",
      preview: "hello",
      messageCount: 5,
      project: "my-proj",
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://pi-dump.quick.shopify.io/api/db/dumps");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe("Bearer mock-iap-token");
    expect(JSON.parse(opts.body)).toEqual({
      uuid: "abc123",
      owner: "me@shopify.com",
      preview: "hello",
      messageCount: 5,
      project: "my-proj",
    });
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => "bad request",
    });

    await expect(
      createDumpRecord({
        uuid: "x",
        owner: "x",
        preview: "",
        messageCount: 0,
        project: "",
      }),
    ).rejects.toThrow("DB create failed (400): bad request");
  });
});

// ── listDumpRecords ──────────────────────────────────────────────

describe("listDumpRecords", () => {
  it("fetches records filtered by owner", async () => {
    const records = [{ uuid: "abc", owner: "me@shopify.com" }];
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => records });

    const result = await listDumpRecords("me@shopify.com");

    expect(result).toEqual(records);
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/db/dumps?");
    expect(url).toContain("me%40shopify.com");
  });

  it("returns empty array on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const result = await listDumpRecords("me@shopify.com");
    expect(result).toEqual([]);
  });
});
