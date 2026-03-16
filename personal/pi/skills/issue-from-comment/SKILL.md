---
name: issue-from-comment
description: Create a GitHub issue from a PR comment. Researches the comment context, suggests labels, and writes an AI-implementable issue on the Marketing Efficiency Team project board (shop/issues-marketing-efficiency). Use when the user shares a PR comment URL or asks to turn a review comment into an issue.
---

# Issue from PR Comment

Turn a PR review comment into a well-researched, AI-implementable GitHub issue on the Marketing Efficiency Team board.

## Input

The user provides one of:
- A PR comment URL (e.g., `https://github.com/shop/world/pull/123456#discussion_r12345`)
- A PR number + description of the comment
- A pasted comment body with context

## Step 1: Gather Context

### Fetch the comment and PR

```bash
# If given a PR URL with comment anchor, fetch the PR and its review comments
gh pr view <pr_number> --repo shop/world --json title,body,files,labels,headRefName
gh api repos/shop/world/pulls/<pr_number>/comments --jq '.[] | {id, body: .body[0:200], path, line, created_at, user: .user.login}'
```

If given a specific comment URL, extract the comment ID and fetch it directly:
```bash
gh api repos/shop/world/pulls/comments/<comment_id> --jq '{body, path, line, diff_hunk, user: .user.login}'
```

### Read the relevant code

Use the `path` and `line` from the comment to read the actual code being discussed. Read enough surrounding context (±30 lines) to understand the full picture — not just the commented line.

### Understand the PR's intent

Read the PR description and the diff for the file(s) the comment touches:
```bash
gh pr diff <pr_number> --repo shop/world -- <file_path>
```

## Step 2: Research Related Issues

Search for existing issues that might be related or duplicates:

```bash
# Search by keywords from the comment
gh issue list --repo shop/issues-marketing-efficiency --search "<key terms>" --state open --limit 10 --json number,title,labels,url

# Check what's already on the project board with similar themes
gh project item-list 665 --owner shop --limit 50 --format json
```

If a duplicate or closely related issue exists, tell the user and suggest linking instead of creating a new one.

## Step 3: Suggest Labels

Based on the context gathered, suggest labels. Check what labels exist in the issues repo:

```bash
gh label list --repo shop/issues-marketing-efficiency --limit 50
```

Common labels on this board include platform-specific labels (e.g., `atc`, `Ad Objects`) and GSD labels (`#gsd:*`). Match based on the area of code the comment touches.

Present the suggested labels and ask the user to confirm before creating.

## Step 4: Write the Issue Body

The issue must be written so that a developer using an AI coding agent can plan and implement it. Follow this structure (based on team conventions):

### Title
Concise, action-oriented. Start with a verb. Example: "Remove legacy HTTP download path from batch CSV import"

### Body Structure

```markdown
## Context

<Background on the area of code. Explain the current state — what exists, how it works, why it's relevant. Reference exact file paths and method names. A developer's AI agent will use this to orient itself in the codebase.>

## Goal

<One or two sentences: what should change and why.>

## Pre-implementation steps (discuss with developer)

<Optional. Include when the change requires verification or team discussion before coding — e.g., checking production metrics, confirming assumptions, getting stakeholder approval.>

1. <Step with specific metrics, dashboards, or people to consult>

## Implementation steps

<Numbered steps, each targeting a specific file. Include enough detail that an AI agent can execute each step without ambiguity.>

### 1. <Action>

**File:** `exact/path/to/file.rb`

- <What to change — be specific about methods, line ranges, branches to remove/add>
- <Reference existing patterns in the codebase when relevant>

### 2. <Action>

**File:** `exact/path/to/other_file.rb`

- <What to change>

### 3. Update tests

**File:** `test/path/to/test_file.rb`

- <What tests to remove, add, or modify>
- <What to search for to find relevant tests — e.g., "search for stub_request and storage.googleapis.com">

### 4. Verify

- <Specific commands to run: typecheck, test, lint>
- <Expected outcomes>
```

Key principles for the body:
- **Reference exact file paths and method names** — the AI agent will grep for these
- **Explain what to delete, not just what to add** — removal steps are easily missed
- **Include verification commands** — typecheck, test, lint with exact commands
- **Pre-implementation steps are for humans** — things that need judgment, metrics review, or team discussion before an AI starts coding

## Step 5: Create the Issue

```bash
# Write body to temp file to avoid shell escaping issues
cat > /tmp/issue-body.md << 'ISSUE_EOF'
<issue body>
ISSUE_EOF

# Create the issue with labels in the issues repo
gh issue create \
  --repo shop/issues-marketing-efficiency \
  --title "<title>" \
  --body-file /tmp/issue-body.md \
  --label "<label1>" --label "<label2>" \
  --project "Marketing Efficiency Team"

# Clean up
rm /tmp/issue-body.md
```

Capture the issue URL from the output.

## Step 6: Set Status to Backlog

After creating the issue, add it to the project and set status to Backlog:

```bash
# 1. Add issue to the project and get the item ID
ITEM_ID=$(gh project item-add 665 --owner shop --url <issue_url> --format json | jq -r '.id')

# 2. Look up the project's node ID and Status field details
PROJECT_ID=$(gh project view 665 --owner shop --format json | jq -r '.id')
STATUS_FIELD=$(gh project field-list 665 --owner shop --format json | jq '.fields[] | select(.name == "Status")')
FIELD_ID=$(echo "$STATUS_FIELD" | jq -r '.id')
BACKLOG_OPTION_ID=$(echo "$STATUS_FIELD" | jq -r '.options[] | select(.name == "Backlog") | .id')

# 3. Set status to Backlog
gh project item-edit \
  --project-id "$PROJECT_ID" \
  --id "$ITEM_ID" \
  --field-id "$FIELD_ID" \
  --single-select-option-id "$BACKLOG_OPTION_ID"
```

## Step 7: Report

Show the user:
- Issue URL
- Title and labels applied
- Project board status (Backlog)
- Any related issues found
