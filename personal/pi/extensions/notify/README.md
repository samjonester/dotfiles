---
summary: Desktop notification when the agent finishes and is waiting for input.
commands: [/notify]
category: productivity
keywords: [notification, desktop, alert]
---

# Notify Extension

Desktop notification when the agent finishes and is waiting for input.

Uses OSC 9 for iTerm2, OSC 99 for Kitty, and OSC 777 for Ghostty, WezTerm, and other terminals that support it. The terminal is detected via `TERM_PROGRAM`.

If the current terminal doesn't support OSC escape sequences (e.g. VS Code's integrated terminal), the extension falls back to `osascript` to send a native macOS notification.

## What it does

Fires a native OS notification at the end of every agent turn with a summary of the last assistant message. Useful when you kick off a long task and switch to another window.

It also listens for the `"notify:send"` global event, allowing other extensions to trigger notifications mid-turn. This is used by extensions like `guard` to alert you when they are blocked waiting for your input.

## Setup

Run `/notify` to send a test notification. This will allow you to enable notifications (if needed).
