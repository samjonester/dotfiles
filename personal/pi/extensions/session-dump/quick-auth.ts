import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { execSync } from "child_process";

export function getQuickConfigDir(): string {
  return join(
    process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
    "quick",
  );
}

export function ensureOAuthClient(): string {
  const configDir = getQuickConfigDir();
  const clientPath = join(configDir, "oauth-client.json");

  if (!existsSync(clientPath)) {
    try {
      execSync(
        `gcloud storage cp gs://skai-train-quick/config/oauth-client.json ${clientPath}`,
        { stdio: "ignore", timeout: 10000 },
      );
    } catch {
      throw new Error(
        "Failed to fetch OAuth client config. Ensure gcloud is installed or run `quick auth`.",
      );
    }
  }
  return clientPath;
}

export function loadOAuthClient(): {
  client_id: string;
  client_secret: string;
} {
  const clientPath = ensureOAuthClient();
  const data = JSON.parse(readFileSync(clientPath, "utf-8"));
  return data.installed;
}

export function loadCredentials(): {
  refresh_token: string;
  expiry?: string;
  id_token?: string;
} | null {
  const credsPath = join(getQuickConfigDir(), "credentials.json");
  if (!existsSync(credsPath)) return null;
  try {
    return JSON.parse(readFileSync(credsPath, "utf-8"));
  } catch {
    return null;
  }
}

export async function getIAPToken(): Promise<string> {
  const creds = loadCredentials();
  if (!creds?.refresh_token) {
    throw new Error("No Quick credentials found. Run `quick auth` first.");
  }

  const client = loadOAuthClient();
  const params = new URLSearchParams({
    client_id: client.client_id,
    client_secret: client.client_secret,
    refresh_token: creds.refresh_token,
    grant_type: "refresh_token",
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!response.ok) {
    throw new Error(
      `Token refresh failed (${response.status}). Run: quick auth`,
    );
  }

  const data = await response.json();
  return data.id_token;
}
