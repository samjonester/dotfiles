import { randomUUID } from "crypto";
import { getIAPToken } from "./quick-auth.js";

const BASE_URL = "https://pi-dump.quick.shopify.io";
const COLLECTION = "dumps";

export interface DumpRecord {
  id?: string;
  uuid: string;
  owner: string;
  preview: string;
  messageCount: number;
  project: string;
  gitRepo: string;
  gitBranch: string;
  gitBranchUrl: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  totalCost: number;
  models: string[];
  worldArea: string;
  worldSlice: string;
  created_at?: string;
}

/**
 * Upload a JSONL string to Quick FS.
 * Returns { uuid, url } where uuid is the generated file id and
 * url is the full serving URL for the file.
 */
export async function uploadSessionFile(
  jsonl: string,
): Promise<{ uuid: string; url: string }> {
  const token = await getIAPToken();
  const uuid = randomUUID().replace(/-/g, "").slice(0, 12);
  const filename = `${uuid}.jsonl`;

  const boundary = `----PiSessionDump${Date.now()}`;
  const body = [
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="files"; filename="${filename}"\r\n`,
    `Content-Type: application/jsonl\r\n\r\n`,
    jsonl,
    `\r\n--${boundary}--\r\n`,
  ].join("");

  const response = await fetch(`${BASE_URL}/api/fs/upload?strategy=original`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Upload failed (${response.status}): ${text}`);
  }

  const result = await response.json();
  const fileUrl =
    result.files?.[0]?.fullUrl || `${BASE_URL}/files/${filename}`;

  return { uuid, url: fileUrl };
}

/**
 * Download a session JSONL file from Quick FS by uuid.
 * Returns the raw JSONL string.
 */
export async function downloadSessionFile(
  uuid: string,
): Promise<string> {
  const token = await getIAPToken();
  const filename = `${uuid}.jsonl`;

  const response = await fetch(`${BASE_URL}/files/${filename}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Session "${uuid}" not found on pi-dump.quick.shopify.io`);
    }
    throw new Error(
      `Download failed (${response.status}): ${response.statusText}`,
    );
  }

  return response.text();
}

/**
 * Create a dump record in Quick's DB.
 */
export async function createDumpRecord(
  record: Omit<DumpRecord, "id" | "created_at">,
): Promise<void> {
  const token = await getIAPToken();

  const response = await fetch(`${BASE_URL}/api/db/${COLLECTION}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(record),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DB create failed (${response.status}): ${text}`);
  }
}

/**
 * List dump records for a given owner email.
 * Returns most recent first.
 */
export async function listDumpRecords(
  owner: string,
): Promise<DumpRecord[]> {
  const token = await getIAPToken();

  const params = new URLSearchParams({
    where: JSON.stringify({ owner }),
    orderBy: "created_at:desc",
    limit: "50",
  });

  const response = await fetch(
    `${BASE_URL}/api/db/${COLLECTION}?${params}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!response.ok) return [];
  return response.json();
}
