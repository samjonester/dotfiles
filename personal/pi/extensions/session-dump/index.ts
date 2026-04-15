import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  readSessionJSONL,
  writeSessionFile,
  extractPreview,
  countMessages,
  getUserEmail,
  getProjectName,
  getGitRepo,
  getGitBranch,
  getGitBranchUrl,
  getSessionStats,
  getWorldAreaAndSlice,
} from "./session-io.js";
import {
  uploadSessionFile,
  downloadSessionFile,
  createDumpRecord,
  listDumpRecords,
} from "./quick-fs.js";

export default function (pi: ExtensionAPI) {
  // ── /session-dump ──────────────────────────────────────────────
  pi.registerCommand("session-dump", {
    description:
      "Upload the current session to pi-dump.quick.shopify.io. Returns a UUID for retrieval.",
    handler: async (_args, ctx) => {
      try {
        const sm = ctx.sessionManager;
        const sessionFile = sm.getSessionFile?.();
        if (!sessionFile) {
          ctx.ui.notify("No persisted session to dump (in-memory mode)", "error");
          return;
        }

        const jsonl = readSessionJSONL(sessionFile);
        const msgCount = countMessages(jsonl);
        const preview = extractPreview(jsonl);

        const ok = await ctx.ui.confirm(
          "Dump Session",
          `Upload ${msgCount} messages to pi-dump.quick.shopify.io?\n\n"${preview || "(empty session)"}"`,
        );
        if (!ok) return;

        ctx.ui.notify("Uploading…", "info");

        const { uuid, url } = await uploadSessionFile(jsonl);

        const owner = getUserEmail();
        const project = getProjectName(ctx.cwd);
        const stats = getSessionStats(jsonl);
        const { area, slice } = getWorldAreaAndSlice(ctx.cwd);
        await createDumpRecord({
          uuid,
          owner,
          preview: preview.slice(0, 200),
          messageCount: msgCount,
          project,
          gitRepo: getGitRepo(),
          gitBranch: getGitBranch(),
          gitBranchUrl: getGitBranchUrl(),
          ...stats,
          worldArea: area,
          worldSlice: slice,
        });

        const dumpUrl = `https://pi-dump.quick.shopify.io/?dump=${uuid}`;

        ctx.ui.notify(`✓ Dumped: ${uuid}`, "info");

        pi.sendMessage(
          {
            customType: "session-dump",
            content: `Session dumped.\n\n**UUID:** \`${uuid}\`\n**URL:** ${dumpUrl}\n\nLoad with: \`/session-load ${uuid}\``,
            display: true,
            details: { uuid, url: dumpUrl, msgCount },
          },
          { deliverAs: "followUp" },
        );
      } catch (err: any) {
        const msg = err?.message || String(err);
        if (msg.includes("quick auth") || msg.includes("credentials")) {
          ctx.ui.notify("Run `quick auth` in your terminal first", "error");
        } else {
          ctx.ui.notify(`Dump failed: ${msg}`, "error");
        }
      }
    },
  });

  // ── /session-load ──────────────────────────────────────────────
  pi.registerCommand("session-load", {
    description:
      "Download a dumped session by UUID and save it locally. Use /resume to switch to it.",
    handler: async (args, ctx) => {
      try {
        let uuid = args?.trim() || "";

        // No UUID given — show a picker of the user's recent dumps
        if (!uuid) {
          const owner = getUserEmail();
          const records = await listDumpRecords(owner);

          if (records.length === 0) {
            ctx.ui.notify("No dumps found. Use /session-dump first.", "info");
            return;
          }

          const choices = records.map((r) => {
            const age = r.created_at
              ? timeSince(new Date(r.created_at))
              : "unknown";
            const label = r.preview
              ? `${r.preview.slice(0, 60)}…`
              : "(empty)";
            return `${r.uuid}  ${r.project}  ${r.messageCount} msgs  ${age}  ${label}`;
          });

          const picked = await ctx.ui.select("Pick a session to load:", choices);
          if (picked === undefined) return;
          uuid = picked.split("  ")[0];
        }

        ctx.ui.notify(`Downloading ${uuid}…`, "info");

        const jsonl = await downloadSessionFile(uuid);
        const msgCount = countMessages(jsonl);
        const preview = extractPreview(jsonl);

        const ok = await ctx.ui.confirm(
          "Load Session",
          `Import ${msgCount} messages?\n\n"${preview || "(empty session)"}"`,
        );
        if (!ok) return;

        const cwd = ctx.cwd;
        const filePath = writeSessionFile(jsonl, cwd);

        ctx.ui.notify(`✓ Saved to ${filePath}`, "info");

        pi.sendMessage(
          {
            customType: "session-dump",
            content: `Session loaded.\n\n**File:** \`${filePath}\`\n\nUse \`/resume\` to switch to it.`,
            display: true,
            details: { uuid, filePath, msgCount },
          },
          { deliverAs: "followUp" },
        );
      } catch (err: any) {
        const msg = err?.message || String(err);
        if (msg.includes("quick auth") || msg.includes("credentials")) {
          ctx.ui.notify("Run `quick auth` in your terminal first", "error");
        } else {
          ctx.ui.notify(`Load failed: ${msg}`, "error");
        }
      }
    },
  });
}

function timeSince(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
