/**
 * Slack Guard — Confirmation gate for outbound Slack messages.
 *
 * Intercepts `slack_post` and `slack_send_message_draft` tool calls
 * with a y/n confirmation dialog. Prevents the agent from posting
 * to Slack without explicit human approval.
 *
 * Always active — no toggle. The dialog shows channel, message preview,
 * and thread context. Deny enters feedback mode (tell the agent what
 * to do instead).
 */

import {
  isToolCallEventType,
  DynamicBorder,
  type ExtensionAPI,
  type ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import {
  Container,
  Input,
  matchesKey,
  Key,
  Spacer,
  Text,
  type Theme,
} from "@anthropic-ai/tui";
import { execFile } from "node:child_process";

const GATED_TOOLS = new Set(["slack_post", "slack_send_message_draft"]);

function isTerminalControlSequence(data: string): boolean {
  if (data === "\x1b") return true;
  if (data.startsWith("\x1b[") && data.length > 2) return true;
  if (data.startsWith("\x1bO") && data.length > 2) return true;
  if (data.startsWith("\x1b]")) return true;
  if (data.startsWith("\x1bP")) return true;
  if (data.startsWith("\x1b_")) return true;
  return false;
}

function alertUser(label: string) {
  process.stderr.write("\x07");
  execFile(
    "osascript",
    ["-e", `display notification "${label}" with title "💬 Slack Guard"`],
    () => {},
  );
}

function border(theme: Theme) {
  return new DynamicBorder((s: string) => theme.fg("borderAccent", s));
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function isTeammateSession(): boolean {
  return process.env.PI_TEAM_ROLE === "teammate";
}

async function showSlackConfirmDialog(
  ctx: ExtensionContext,
  toolName: string,
  channel: string,
  messagePreview: string,
  threadTs?: string,
): Promise<{ allowed: boolean; instructions?: string }> {
  return ctx.ui.custom<{ allowed: boolean; instructions?: string }>(
    (tui, theme, _kb, done) => {
      let mode: "decide" | "feedback" = "decide";
      let resolved = false;
      const dialogOpenedAt = Date.now();
      const INPUT_COOLDOWN_MS = 500;

      const container = new Container();
      container.addChild(border(theme));
      container.addChild(new Spacer(1));

      const label =
        toolName === "slack_send_message_draft" ? "Slack draft" : "Slack post";
      container.addChild(
        new Text(
          "  " + theme.fg("accent", theme.bold(`💬 ${label}`)),
          1,
          0,
        ),
      );
      container.addChild(new Spacer(1));

      // Channel
      container.addChild(
        new Text(
          "  " +
            theme.fg("muted", "Channel: ") +
            theme.fg("warning", channel),
          1,
          0,
        ),
      );

      // Thread context
      if (threadTs) {
        container.addChild(
          new Text(
            "  " +
              theme.fg("muted", "Thread:  ") +
              theme.fg("dim", threadTs),
            1,
            0,
          ),
        );
      }

      container.addChild(new Spacer(1));

      // Message preview (first 3 lines, truncated)
      const lines = messagePreview.split("\n").slice(0, 3);
      for (const line of lines) {
        container.addChild(
          new Text("  " + theme.fg("fg", truncate(line, 100)), 1, 0),
        );
      }
      if (messagePreview.split("\n").length > 3) {
        container.addChild(
          new Text("  " + theme.fg("dim", `… (${messagePreview.split("\n").length} lines total)`), 1, 0),
        );
      }

      const feedbackInput = new Input();
      feedbackInput.onSubmit = (value: string) => {
        if (resolved) return;
        resolved = true;
        done({ allowed: false, instructions: value || undefined });
      };
      feedbackInput.onEscape = () => {
        if (resolved) return;
        resolved = true;
        done({ allowed: false });
      };

      const footerSpacer = new Spacer(1);
      const hintsText = new Text(
        "  " +
          theme.fg("dim", "y") +
          theme.fg("muted", " send  ") +
          theme.fg("dim", "n") +
          theme.fg("muted", " deny  ") +
          theme.fg("dim", "esc") +
          theme.fg("muted", " dismiss"),
        1,
        0,
      );
      const bottomSpacer = new Spacer(1);
      const bottomBorder = border(theme);

      container.addChild(footerSpacer);
      container.addChild(hintsText);
      container.addChild(bottomSpacer);
      container.addChild(bottomBorder);

      const repaint = () => {
        container.invalidate();
        tui.requestRender();
      };

      const enterFeedbackMode = () => {
        mode = "feedback";

        container.removeChild(footerSpacer);
        container.removeChild(hintsText);
        container.removeChild(bottomSpacer);
        container.removeChild(bottomBorder);

        container.addChild(
          new Text(
            "  " + theme.fg("muted", "Tell the agent what to do instead:"),
            1,
            0,
          ),
        );
        container.addChild(feedbackInput);
        container.addChild(new Spacer(1));

        hintsText.setText(
          "  " +
            theme.fg("dim", "enter") +
            theme.fg("muted", " submit  ") +
            theme.fg("dim", "esc") +
            theme.fg("muted", " skip"),
        );
        container.addChild(hintsText);
        container.addChild(bottomSpacer);
        container.addChild(bottomBorder);

        feedbackInput.focused = true;
        repaint();
      };

      return {
        render: (w: number) => container.render(w),
        invalidate: () => container.invalidate(),
        handleInput: (data: string) => {
          if (resolved) return;
          if (isTerminalControlSequence(data)) return;
          if (Date.now() - dialogOpenedAt < INPUT_COOLDOWN_MS) return;
          if (mode === "feedback") {
            feedbackInput.handleInput(data);
            repaint();
            return;
          }
          if (data === "y" || data === "Y") {
            resolved = true;
            done({ allowed: true });
          } else if (data === "n" || data === "N") {
            enterFeedbackMode();
          } else if (matchesKey(data, Key.escape)) {
            resolved = true;
            done({ allowed: false });
          }
        },
        get focused() {
          return feedbackInput.focused;
        },
        set focused(v: boolean) {
          feedbackInput.focused = v;
        },
      };
    },
  );
}

export default function slackGuard(pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    // Check each gated tool name
    let matched = false;
    let toolName = "";
    for (const name of GATED_TOOLS) {
      if (isToolCallEventType(name, event)) {
        matched = true;
        toolName = name;
        break;
      }
    }
    if (!matched) return;

    const input = event.input as Record<string, unknown>;

    // Extract channel and message from tool input
    const channel = String(input.channel_id ?? input.channel ?? "unknown");
    const message = String(input.text ?? input.message ?? "");
    const threadTs = input.thread_ts ? String(input.thread_ts) : undefined;

    // Teammates: always block (no human watching to confirm)
    if (isTeammateSession()) {
      return {
        block: true,
        reason: `Slack ${toolName} blocked in teammate session. Report the message to the lead for posting.`,
      };
    }

    if (!ctx.hasUI) {
      return {
        block: true,
        reason: `Slack ${toolName} blocked in non-interactive mode. Cannot confirm without a UI.`,
      };
    }

    alertUser(`Slack message → ${channel}`);
    const result = await showSlackConfirmDialog(
      ctx,
      toolName,
      channel,
      message,
      threadTs,
    );

    if (!result.allowed) {
      const reason = result.instructions
        ? `Slack ${toolName} blocked by user.\n\nUser instructions: ${result.instructions}`
        : `Slack ${toolName} blocked by user.`;
      return { block: true, reason };
    }

    // Allowed — let the tool call proceed
    return undefined;
  });
}
