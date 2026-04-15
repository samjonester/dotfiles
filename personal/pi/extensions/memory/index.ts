/**
 * Persistent Memory Extension
 *
 * Gives pi a personal memory bank that persists across sessions.
 * Inspired by shopify-playground/brain's memory bank system.
 *
 * On session start: loads activeProjects.md, dailyContext.md, and
 * knowledge/index.csv into context. Archives dailyContext.md when
 * the date rolls over.
 *
 * On agent_end / session_before_switch / session_shutdown: auto-persists
 * a summary of completed work to dailyContext.md's Completed section when
 * the agent hasn't already called memory_update or memory_append.
 *
 * Provides tools for the agent to read/update memory bank files
 * and a /memory command to inspect current state.
 *
 * Memory bank location: ~/.pi/memory/
 *   core/activeProjects.md  — active work and priorities
 *   core/dailyContext.md    — today's work, decisions, carry-forward
 *   knowledge/              — reference docs with trigger-word index
 *   knowledge/index.csv     — "filename,description,trigger_words"
 *   history/daily/          — archived dailyContext by date
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const MEMORY_ROOT =
  process.env.PI_MEMORY_DIR ?? path.join(os.homedir(), ".pi", "memory");
const CORE_DIR = path.join(MEMORY_ROOT, "core");
const KNOWLEDGE_DIR = path.join(MEMORY_ROOT, "knowledge");
const HISTORY_DIR = path.join(MEMORY_ROOT, "history", "daily");

// ── Helpers ──────────────────────────────────────────────────────

function ensureDirs() {
  for (const dir of [CORE_DIR, KNOWLEDGE_DIR, HISTORY_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readIfExists(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function yearMonth(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

/** Extract the date from dailyContext.md's "## Date" or first line */
function extractDate(content: string): string | null {
  const match = content.match(/^##?\s*(?:Date:?\s*)?(\d{4}-\d{2}-\d{2})/m);
  return match?.[1] ?? null;
}

/** Archive yesterday's dailyContext and start fresh */
function archiveDailyContext(): { archived: boolean; archivePath?: string } {
  const dailyPath = path.join(CORE_DIR, "dailyContext.md");
  const content = readIfExists(dailyPath);
  if (!content) return { archived: false };

  const fileDate = extractDate(content);
  if (!fileDate || fileDate === today()) return { archived: false };

  // Archive to history/daily/YYYY-MM/YYYY-MM-DD-dailyContext.md
  const ym = fileDate.slice(0, 7);
  const archiveDir = path.join(HISTORY_DIR, ym);
  fs.mkdirSync(archiveDir, { recursive: true });

  const archivePath = path.join(archiveDir, `${fileDate}-dailyContext.md`);
  fs.writeFileSync(archivePath, content, "utf-8");

  // Reset dailyContext with today's date and carry-forward section
  const carryForward = extractSection(content, "Context for Tomorrow") ?? "";
  const fresh = [
    `## ${today()}`,
    "",
    "### Current Session",
    "- Starting new session",
    "",
    ...(carryForward ? ["### Carried Forward", carryForward, ""] : []),
    "### In Progress",
    "",
    "### Completed",
    "",
    "### Key Decisions",
    "",
    "### Context for Tomorrow",
    "",
  ].join("\n");

  fs.writeFileSync(dailyPath, fresh, "utf-8");
  return { archived: true, archivePath };
}

/** Extract a markdown section by heading */
function extractSection(content: string, heading: string): string | null {
  const regex = new RegExp(`^###?\\s+${heading}\\s*$`, "m");
  const match = content.match(regex);
  if (!match || match.index === undefined) return null;

  const start = match.index + match[0].length;
  const nextHeading = content.slice(start).search(/^###?\s+/m);
  const section =
    nextHeading === -1
      ? content.slice(start)
      : content.slice(start, start + nextHeading);

  return section.trim() || null;
}

/**
 * Parse a CSV line respecting double-quoted fields.
 * Splits on commas but keeps quoted regions intact.
 */
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

/** Parse knowledge/index.csv for trigger words */
function loadKnowledgeTriggers(): Array<{
  filename: string;
  description: string;
  triggers: string[];
}> {
  const indexPath = path.join(KNOWLEDGE_DIR, "index.csv");
  const content = readIfExists(indexPath);
  if (!content) return [];

  return content
    .split("\n")
    .slice(1) // skip header
    .filter((line) => line.trim())
    .map((line) => {
      const parts = parseCSVLine(line);
      if (parts.length < 3) return null;
      return {
        filename: parts[0],
        description: parts[1],
        triggers: parts[2]
          .split(/[,;]/)
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean),
      };
    })
    .filter(Boolean) as Array<{
    filename: string;
    description: string;
    triggers: string[];
  }>;
}

/** Find knowledge files whose trigger words match the input */
function matchKnowledge(input: string): string[] {
  const triggers = loadKnowledgeTriggers();
  const lower = input.toLowerCase();
  const matched: string[] = [];

  for (const entry of triggers) {
    if (entry.triggers.some((t) => lower.includes(t))) {
      const filePath = path.join(KNOWLEDGE_DIR, entry.filename);
      const content = readIfExists(filePath);
      if (content) {
        matched.push(
          `--- ${entry.filename}: ${entry.description} ---\n${content}`,
        );
      }
    }
  }

  return matched;
}

/** Scaffold default memory bank files if they don't exist */
function scaffold() {
  ensureDirs();

  const activeProjectsPath = path.join(CORE_DIR, "activeProjects.md");
  if (!fs.existsSync(activeProjectsPath)) {
    fs.writeFileSync(
      activeProjectsPath,
      [
        "# Active Projects",
        "",
        "<!-- Format: - [Project Name] (P0-P4) - path/or/description - [aliases] -->",
        "",
        "## P0 — Critical",
        "",
        "## P1 — High",
        "",
        "## P2 — Medium",
        "",
        "## P3 — Low",
        "",
      ].join("\n"),
      "utf-8",
    );
  }

  const dailyContextPath = path.join(CORE_DIR, "dailyContext.md");
  if (!fs.existsSync(dailyContextPath)) {
    fs.writeFileSync(
      dailyContextPath,
      [
        `## ${today()}`,
        "",
        "### Current Session",
        "- First session with memory bank",
        "",
        "### In Progress",
        "",
        "### Completed",
        "",
        "### Key Decisions",
        "",
        "### Context for Tomorrow",
        "",
      ].join("\n"),
      "utf-8",
    );
  }

  const indexPath = path.join(KNOWLEDGE_DIR, "index.csv");
  if (!fs.existsSync(indexPath)) {
    fs.writeFileSync(
      indexPath,
      "filename,description,trigger_words\n",
      "utf-8",
    );
  }
}

// ── Auto-Persist ─────────────────────────────────────────────────

/** AgentMessage type alias (duck-typed for minimal coupling) */
type AnyMessage = Record<string, any>;

/**
 * Analyse messages from an agent run and produce a one-line summary for
 * dailyContext.md's Completed section, or null if nothing meaningful happened.
 *
 * Skips if:
 *   - Fewer than 3 assistant turns (trivial / no real work)
 *   - The agent already called memory_update or memory_append (already persisted)
 *   - The session is a subagent run (first user message starts with "Task:" or agent frontmatter)
 *   - No tool calls that indicate file changes or significant commands
 */
function extractSessionSummary(messages: AnyMessage[]): string | null {
  // Require at least 3 assistant messages (multi-turn = real work)
  const assistantMessages = messages.filter((m) => m.role === "assistant");
  if (assistantMessages.length < 3) return null;

  // If the agent manually touched memory, trust it and skip auto-persist
  const memoryAlreadyUpdated = messages.some(
    (m) =>
      m.role === "toolResult" &&
      (m.toolName === "memory_update" || m.toolName === "memory_append"),
  );
  if (memoryAlreadyUpdated) return null;

  // Pull the first user prompt as the session description
  const firstUserMsg = messages.find((m) => m.role === "user");
  const rawPrompt = firstUserMsg
    ? typeof firstUserMsg.content === "string"
      ? firstUserMsg.content
      : Array.isArray(firstUserMsg.content)
        ? (firstUserMsg.content.find((c: AnyMessage) => c.type === "text")
            ?.text ?? "")
        : ""
    : "";

  // Skip subagent runs — they produce high-volume, low-value entries
  // (e.g., 5 identical review-* subagent summaries for one PR review).
  // Detection: the subagent tool injects the task as "Task: ..." and/or
  // agent definition frontmatter as "---\nname: ..."
  const trimmed = rawPrompt.trimStart();
  if (trimmed.startsWith("Task:") || /^---\r?\nname:/m.test(trimmed)) {
    return null;
  }
  const promptExcerpt = rawPrompt.replace(/\n/g, " ").trim().slice(0, 80);

  // Walk all assistant tool calls and collect file changes + bash commands
  const modifiedFiles = new Set<string>();
  const significantCmds: string[] = [];

  for (const msg of assistantMessages) {
    if (!Array.isArray(msg.content)) continue;
    for (const block of msg.content as AnyMessage[]) {
      if (block.type !== "toolCall") continue;
      const name: string = block.name ?? "";
      const args: AnyMessage = block.arguments ?? {};

      if (name === "write" || name === "edit") {
        const p: string = args.path ?? args.file ?? "";
        if (p) modifiedFiles.add(path.basename(p));
      } else if (name === "bash") {
        // Grab first line of the command, strip trivial invocations
        const cmd = (args.command ?? "").split("\n")[0].trim().slice(0, 60);
        if (cmd.length > 3 && !cmd.startsWith("#") && !cmd.startsWith("echo")) {
          significantCmds.push(cmd);
        }
      }
    }
  }

  // Nothing actionable happened
  if (modifiedFiles.size === 0 && significantCmds.length === 0) return null;

  // Build the summary line
  const parts: string[] = [];
  if (promptExcerpt) parts.push(`"${promptExcerpt}"`);
  if (modifiedFiles.size > 0) {
    parts.push(`modified: ${[...modifiedFiles].slice(0, 3).join(", ")}`);
  }
  if (significantCmds.length > 0) {
    // Most telling command is usually the first meaningful one
    parts.push(`ran: ${significantCmds[0]}`);
  }

  return `- [auto] ${parts.join(" — ")}`;
}

/**
 * Append a text entry to the "Completed" section of dailyContext.md.
 * Uses the same logic as the memory_append tool.
 */
function appendToCompleted(text: string): void {
  const filePath = path.join(CORE_DIR, "dailyContext.md");
  const content = readIfExists(filePath);
  if (!content) return;

  const regex = /^(###?\s+Completed\s*)$/m;
  const match = content.match(regex);
  if (!match || match.index === undefined) return;

  const insertPoint = match.index + match[0].length;
  const after = content.slice(insertPoint);
  const nextHeading = after.search(/^###?\s+/m);

  let updated: string;
  if (nextHeading === -1) {
    updated = content.trimEnd() + "\n" + text + "\n";
  } else {
    const before = content.slice(0, insertPoint + nextHeading);
    const rest = content.slice(insertPoint + nextHeading);
    updated = before.trimEnd() + "\n" + text + "\n\n" + rest;
  }

  fs.writeFileSync(filePath, updated, "utf-8");
}

// ── Extension ────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  scaffold();

  // Track the most recent agent messages so session_before_switch /
  // session_shutdown can access them without receiving them directly.
  let lastAgentMessages: AnyMessage[] = [];
  let lastAgentPersisted = false;

  // ── Session Start: load memory + archive stale dailyContext ──
  pi.on("session_start", async (_event, ctx) => {
    // Reset per-session auto-persist tracking
    lastAgentMessages = [];
    lastAgentPersisted = false;

    const archive = archiveDailyContext();
    if (archive.archived) {
      ctx.ui.notify(
        `Archived previous dailyContext → ${archive.archivePath}`,
        "info",
      );
    }
  });

  // ── Before Agent Start: inject memory into context ──
  pi.on("before_agent_start", async (event, _ctx) => {
    const activeProjects = readIfExists(
      path.join(CORE_DIR, "activeProjects.md"),
    );
    const dailyContext = readIfExists(path.join(CORE_DIR, "dailyContext.md"));

    const parts: string[] = ["# Memory Bank Context\n"];

    if (activeProjects) {
      parts.push("## Active Projects\n", activeProjects, "");
    }
    if (dailyContext) {
      parts.push("## Daily Context\n", dailyContext, "");
    }

    // Check knowledge triggers against the user's prompt
    const knowledgeHits = matchKnowledge(event.prompt);
    if (knowledgeHits.length > 0) {
      parts.push("## Relevant Knowledge\n", ...knowledgeHits, "");
    }

    return {
      message: {
        customType: "memory-context",
        content: parts.join("\n"),
        display: false,
      },
    };
  });

  // ── Agent End: auto-persist if agent didn't update memory ──
  pi.on("agent_end", async (event, ctx) => {
    lastAgentMessages = event.messages ?? [];
    lastAgentPersisted = false;

    try {
      const summary = extractSessionSummary(lastAgentMessages);
      if (summary) {
        appendToCompleted(summary);
        lastAgentPersisted = true;
        ctx.ui.notify(
          "[memory] Auto-saved session summary to dailyContext.md",
          "info",
        );
      }
    } catch (err) {
      // Never let auto-persist crash the session
      ctx.ui.notify(`[memory] Auto-persist failed: ${err}`, "warning");
    }
  });

  // ── Session Before Switch: flush any un-persisted summary ──
  pi.on("session_before_switch", async (_event, ctx) => {
    if (lastAgentPersisted || lastAgentMessages.length === 0) return;

    try {
      const summary = extractSessionSummary(lastAgentMessages);
      if (summary) {
        appendToCompleted(summary);
        lastAgentPersisted = true;
        ctx.ui.notify(
          "[memory] Auto-saved session summary before switch",
          "info",
        );
      }
    } catch {
      // Silent — we're mid-switch, don't block it
    }
  });

  // ── Session Shutdown: last-chance flush ──
  pi.on("session_shutdown", async (_event, _ctx) => {
    if (lastAgentPersisted || lastAgentMessages.length === 0) return;

    try {
      const summary = extractSessionSummary(lastAgentMessages);
      if (summary) {
        appendToCompleted(summary);
      }
    } catch {
      // Silent — we're exiting
    }
  });

  // ── Tool: memory_read ──
  pi.registerTool({
    name: "memory_read",
    label: "Memory Read",
    description:
      "Read a file from the persistent memory bank. Use to check activeProjects, dailyContext, knowledge files, or daily history.",
    promptSnippet:
      "Read persistent memory bank files (activeProjects, dailyContext, knowledge, history)",
    parameters: Type.Object({
      file: Type.String({
        description:
          "Relative path within ~/.pi/memory/ — e.g. core/activeProjects.md, core/dailyContext.md, knowledge/index.csv, history/daily/2025-03/2025-03-03-dailyContext.md",
      }),
    }),
    async execute(_toolCallId, params) {
      const filePath = path.resolve(MEMORY_ROOT, params.file);
      // Safety: stay inside MEMORY_ROOT
      if (!filePath.startsWith(MEMORY_ROOT)) {
        return {
          content: [
            {
              type: "text",
              text: "Error: path must be within the memory bank directory.",
            },
          ],
          isError: true,
        };
      }
      const content = readIfExists(filePath);
      if (content === null) {
        return {
          content: [{ type: "text", text: `File not found: ${params.file}` }],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: content }] };
    },
  });

  // ── Tool: memory_update ──
  pi.registerTool({
    name: "memory_update",
    label: "Memory Update",
    description:
      "Update a file in the persistent memory bank. Use to maintain activeProjects.md, dailyContext.md, or knowledge files across sessions.",
    promptSnippet:
      "Update persistent memory bank files (activeProjects, dailyContext, knowledge)",
    promptGuidelines: [
      "Update dailyContext.md throughout the session: log completed work, decisions, and carry-forward items.",
      "Update activeProjects.md when project status changes (new projects, completed work, priority shifts).",
      "When updating dailyContext.md sections, APPEND to existing entries — never overwrite the whole section.",
      "Keep dailyContext.md under 150 lines. Keep activeProjects.md under 50 lines.",
    ],
    parameters: Type.Object({
      file: Type.String({
        description:
          "Relative path within ~/.pi/memory/ — e.g. core/dailyContext.md, core/activeProjects.md, knowledge/git-rules.md",
      }),
      content: Type.String({ description: "Full file content to write" }),
    }),
    async execute(_toolCallId, params) {
      const filePath = path.resolve(MEMORY_ROOT, params.file);
      if (!filePath.startsWith(MEMORY_ROOT)) {
        return {
          content: [
            {
              type: "text",
              text: "Error: path must be within the memory bank directory.",
            },
          ],
          isError: true,
        };
      }
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, params.content, "utf-8");
      return {
        content: [
          {
            type: "text",
            text: `Updated ${params.file} (${params.content.length} bytes)`,
          },
        ],
      };
    },
  });

  // ── Tool: memory_append ──
  pi.registerTool({
    name: "memory_append",
    label: "Memory Append",
    description:
      "Append text to a section in a memory bank file. Safer than memory_update for adding entries to dailyContext.md without overwriting.",
    promptSnippet: "Append entries to a section in a memory bank file",
    parameters: Type.Object({
      file: Type.String({
        description:
          "Relative path within ~/.pi/memory/ — e.g. core/dailyContext.md",
      }),
      section: Type.String({
        description:
          'Section heading to append to — e.g. "Completed", "In Progress", "Key Decisions"',
      }),
      text: Type.String({
        description:
          "Text to append (one entry per line, use - prefix for list items)",
      }),
    }),
    async execute(_toolCallId, params) {
      const filePath = path.resolve(MEMORY_ROOT, params.file);
      if (!filePath.startsWith(MEMORY_ROOT)) {
        return {
          content: [
            {
              type: "text",
              text: "Error: path must be within the memory bank directory.",
            },
          ],
          isError: true,
        };
      }
      const content = readIfExists(filePath);
      if (content === null) {
        return {
          content: [{ type: "text", text: `File not found: ${params.file}` }],
          isError: true,
        };
      }

      // Find the section and insert before the next heading
      const regex = new RegExp(`^(###?\\s+${params.section}\\s*)$`, "m");
      const match = content.match(regex);
      if (!match || match.index === undefined) {
        return {
          content: [
            {
              type: "text",
              text: `Section "${params.section}" not found in ${params.file}`,
            },
          ],
          isError: true,
        };
      }

      const insertPoint = match.index + match[0].length;
      const after = content.slice(insertPoint);
      const nextHeading = after.search(/^###?\s+/m);

      let updated: string;
      if (nextHeading === -1) {
        // Last section — append at end
        updated = content.trimEnd() + "\n" + params.text + "\n";
      } else {
        // Insert before next heading
        const before = content.slice(0, insertPoint + nextHeading);
        const rest = content.slice(insertPoint + nextHeading);
        updated = before.trimEnd() + "\n" + params.text + "\n\n" + rest;
      }

      fs.writeFileSync(filePath, updated, "utf-8");
      return {
        content: [
          {
            type: "text",
            text: `Appended to "${params.section}" in ${params.file}`,
          },
        ],
      };
    },
  });

  // ── Tool: memory_list ──
  pi.registerTool({
    name: "memory_list",
    label: "Memory List",
    description:
      "List files in the memory bank. Use to discover available knowledge files and history archives.",
    promptSnippet: "List files in the persistent memory bank",
    parameters: Type.Object({
      directory: Type.Optional(
        Type.String({
          description:
            'Relative directory within ~/.pi/memory/ — e.g. "knowledge", "history/daily", "core". Defaults to root.',
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const dir = path.resolve(MEMORY_ROOT, params.directory ?? ".");
      if (!dir.startsWith(MEMORY_ROOT)) {
        return {
          content: [
            {
              type: "text",
              text: "Error: path must be within the memory bank directory.",
            },
          ],
          isError: true,
        };
      }
      try {
        const entries = listRecursive(dir, MEMORY_ROOT);
        if (entries.length === 0) {
          return { content: [{ type: "text", text: "(empty)" }] };
        }
        return { content: [{ type: "text", text: entries.join("\n") }] };
      } catch {
        return {
          content: [
            {
              type: "text",
              text: `Directory not found: ${params.directory ?? "."}`,
            },
          ],
          isError: true,
        };
      }
    },
  });

  // ── Command: /memory ──
  pi.registerCommand("memory", {
    description:
      "Show memory bank status — current files, sizes, and today's context",
    handler: async (_args, ctx) => {
      const activeProjects = readIfExists(
        path.join(CORE_DIR, "activeProjects.md"),
      );
      const dailyContext = readIfExists(path.join(CORE_DIR, "dailyContext.md"));
      const knowledgeIndex = readIfExists(
        path.join(KNOWLEDGE_DIR, "index.csv"),
      );

      const lines: string[] = [`Memory bank: ${MEMORY_ROOT}`, ""];

      lines.push(
        `activeProjects.md: ${activeProjects ? `${activeProjects.split("\n").length} lines` : "missing"}`,
      );
      lines.push(
        `dailyContext.md:   ${dailyContext ? `${dailyContext.split("\n").length} lines` : "missing"}`,
      );

      const knowledgeCount = knowledgeIndex
        ? knowledgeIndex
            .split("\n")
            .filter((l) => l.trim() && !l.startsWith("filename")).length
        : 0;
      lines.push(`knowledge files:   ${knowledgeCount} entries in index.csv`);

      // Count history archives
      let archiveCount = 0;
      try {
        const months = fs.readdirSync(HISTORY_DIR);
        for (const month of months) {
          const monthDir = path.join(HISTORY_DIR, month);
          if (fs.statSync(monthDir).isDirectory()) {
            archiveCount += fs.readdirSync(monthDir).length;
          }
        }
      } catch {}
      lines.push(`daily archives:    ${archiveCount} files`);

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}

// ── Utils ────────────────────────────────────────────────────────

function listRecursive(
  dir: string,
  root: string,
  maxDepth = 3,
  depth = 0,
): string[] {
  if (depth >= maxDepth) return [];
  const entries: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full);
    if (entry.isDirectory()) {
      entries.push(`${rel}/`);
      entries.push(...listRecursive(full, root, maxDepth, depth + 1));
    } else {
      entries.push(rel);
    }
  }
  return entries;
}
