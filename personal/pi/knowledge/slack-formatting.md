# Slack Message Formatting

User has "Format messages with markup" enabled — use standard markdown, not Slack mrkdwn.

## What Works

- **Bold**: `**text**` or `*text*`
- **Italic**: `_text_`
- **Strikethrough**: `~text~`
- **Inline code**: `` `code` ``
- **Code blocks**: ` ```language\ncode\n``` `
- **Links**: `[text](url)` — Slack renders as clickable
- **Bullet lists**: `- item` or `• item`
- **Numbered lists**: `1. item`
- **Blockquotes**: `> text`
- **Line breaks**: just use newlines

## What Breaks

| Feature                       | Problem                            | Workaround                                  |
| ----------------------------- | ---------------------------------- | ------------------------------------------- |
| `### Headings`                | Renders as literal `###` text      | Use **bold text** on its own line           |
| `<details>` / `<summary>`     | Raw HTML shown to reader           | Remove — put content inline or use a thread |
| HTML tables (`<table>`)       | Raw HTML shown                     | Use aligned text or a code block            |
| Markdown tables (`\| col \|`) | Renders as literal pipe characters | Use aligned text with bold headers          |
| `---` horizontal rules        | Sometimes works, sometimes literal | Use a blank line instead                    |
| Nested blockquotes `>> text`  | Only one level supported           | Flatten to single `>`                       |
| Images `![alt](url)`          | Shows as text link, not embedded   | Just paste the URL — Slack auto-unfurls     |

## Long Content Patterns

- **Max useful message length**: ~4000 chars before Slack truncates. For longer content, split across messages or use a thread.
- **For tabular data**: Use a code block with aligned columns:
  ```
  PR       Author     Status
  #629160  Nathan     REQUEST_CHANGES (stale)
  #611529  Nathan     REQUEST_CHANGES (stale)
  #635950  Mehdiya    APPROVED
  ```
- **For lists with details**: Use bold item + description on same line:
  ```
  - **Missing error handling** — `/translate` endpoint returns 500 on invalid token instead of 401
  - **Label regression** — historical ads show raw enum values instead of display names
  ```

## Code Block Escaping

When the message itself contains triple backticks (e.g., showing code examples):

- The backtick characters in the content will conflict with the wrapping code block
- Workaround: use indented code (4 spaces) for the outer block, or put the example in a thread reply

## Auto-copy

Always pipe final Slack message drafts through `pbcopy` so the user can paste directly.
