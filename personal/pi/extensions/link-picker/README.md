---
summary: Browse and open links from the conversation without fighting terminal line wrapping.
commands: [/links]
category: productivity
keywords: [links, urls, browser, open, click, wrapping]
---

# link-picker

URLs in terminal UIs often wrap across lines, breaking click targets. This
extension scans the conversation for links and presents them in a searchable
overlay so you can open any link reliably.

## Usage

| Action | Description |
|--------|-------------|
| `/links` | Links from the last assistant message |
| `/links all` | Links from the entire conversation |
| `Ctrl+Shift+L` | Same as `/links` (shortcut) |

Type to filter, arrow keys to navigate, Enter to open in your default browser,
Esc to cancel.

## How it works

1. Scans all messages in the current session branch for URLs
2. Extracts both plain URLs and markdown-style `[label](url)` links
3. Deduplicates and shows most recent first
4. Displays friendly labels (e.g. `Shopify/kepler PR #7452` instead of the raw URL)
5. Opens the selected link with `open` (macOS)

## Recognized URL patterns

| Pattern | Label example |
|---------|---------------|
| GitHub PR | `Shopify/kepler PR #7452` |
| GitHub issue | `org/repo Issue #123` |
| GitHub file | `org/repo/file.ts` |
| Buildkite build | `Buildkite: kepler #12345` |
| Slack message | `Slack message` |
| Vault page | `Vault: my-document` |
| Other | `hostname/path` |

## Example

```
/links

 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Links (7)
  ▸ Shopify/kepler PR #7452
    https://github.com/Shopify/kepler/pull/7452
    Shopify/kepler/shop_identity_verification.rb
    https://github.com/Shopify/kepler/blob/main/app/models/concerns/...
    Buildkite: kepler #12345
    https://buildkite.com/shopify/kepler/builds/12345
    Slack message
    https://shopify.slack.com/archives/C0A65C8QT4Y/p1713200000123456
  ↑↓ navigate  type to filter  enter open  esc cancel
 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```
