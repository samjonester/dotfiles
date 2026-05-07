---
description: Copy results to clipboard — wraps any prompt with pbcopy instructions
---
$*

After completing the above, copy the final result to my clipboard using `pbcopy`. The copied content should be **self-contained and ready to paste** — strip any conversational framing, tool-call artifacts, or "here's what I found" preamble. Just the clean output. If the result is code, copy the code. If it's prose, copy the prose. If it's a list/table, copy that. Match what I'd want to paste into the destination (Slack message, PR description, doc, terminal, etc.) based on what I asked for.
