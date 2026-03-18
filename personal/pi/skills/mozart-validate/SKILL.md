---
name: mozart-validate
description: "Manual validation of a Mozart PR. Checks out the PR branch in a WTP worktree, reads the PR description for validation steps, classifies changes as BE/FE/GQL, creates and executes appropriate validation scripts (Rails runner, GQL queries, or Playwright via chrome-devtools), captures evidence, and drafts a top-level PR comment with results. Triggers on: 'validate PR #N', 'validate PR <url>', 'manual validation', 'test this PR', or any request to manually validate a PR's changes."
---

# Manual PR Validation

You validate a PR by executing its claimed behavior — not by reading the code, but by running the code and proving it works. This is the runtime complement to `review-intent`, which assesses intent alignment statically by reading the diff. You check out the branch, read the PR description, classify the change type, build validation scripts, execute them, capture evidence, and draft a PR comment with results.

## Step 1: Resolve the PR

### 1a. Get PR metadata

```bash
gh pr view <number_or_url> --json title,url,body,baseRefName,headRefName,number
```

Extract and save:

- `PR_NUMBER`, `PR_TITLE`, `PR_URL`
- `HEAD_BRANCH`, `BASE_BRANCH`
- `PR_BODY` — the full PR description

If the user provided a URL, parse the number from it. If neither a number nor URL was provided, stop and ask.

### 1b. Checkout the PR branch in a WTP worktree

**Never checkout in the main working tree** — that destroys uncommitted work.

Set `BRANCH` to `<HEAD_BRANCH>`, then follow the WTP checkout flow in [../\_shared/wtp-checkout.md](../_shared/wtp-checkout.md) (prerequisites → claim → sync → prepare runtime).

All subsequent commands (dev server, script execution) run from `$TARGET_DIR`.

### 1c. Start dev server early

Kick off the dev server check now so it has time to warm up while you analyze the PR in Steps 2-3. See Step 4 for the full check/start logic — but start it here so the server is ready by the time you need it in Step 5.

## Step 2: Analyze the PR Description

### 2a. Extract validation steps

Read the PR body for any existing validation/testing/QA sections. Common patterns:

- "How to test", "Testing", "Validation", "QA steps", "Manual testing"
- Numbered step lists describing how to verify the change
- Screenshots or expected behavior descriptions

If validation steps exist, extract them verbatim — you'll verify their accuracy against the code in step 3.

If no validation steps exist, note this — you'll derive validation from the code diff instead.

### 2b. Extract the diff

```bash
gh pr diff <PR_NUMBER> --repo "$REPO"
```

Save the diff for classification and script generation.

## Step 3: Classify the Change

Examine the changed files to determine the change type:

### Frontend indicators

- `web/**`, `app/javascript/**`, `app/assets/**`
- React/TypeScript components (`.tsx`, `.jsx`)
- CSS/SCSS changes
- Playwright/Storybook files
- Vite/webpack config

### Backend indicators

- `app/models/**`, `app/services/**`, `app/controllers/**`, `app/jobs/**`
- `db/migrate/**`
- Ruby files (`.rb`)
- `lib/**`, `config/**`

### GraphQL indicators

- `app/graphql/**`
- Schema files (`.graphql`, `.gql`)
- Resolver, mutation, or type changes
- GQL test files

### Classification rules

- **FE-only**: only frontend indicators → Playwright validation (Step 5a)
- **BE-only**: only backend indicators → Rails runner validation (Step 5b)
- **GQL-only or GQL+BE**: GraphQL indicators present → GQL query validation (Step 5c)
- **Mixed FE+BE**: both layers → run both Playwright AND Rails runner
- **If PR description lists UI validation but change is BE-only**: prefer Rails runner console validation over UI — the PR description's UI steps may be aspirational or copy-pasted from a template. Validate the actual backend behavior directly.
- **If PR description lists UI validation but change is GQL-only**: prefer GQL query validation — execute the actual queries/mutations rather than clicking through UI.

Set `CHANGE_TYPE` to one of: `fe`, `be`, `gql`, `fe+be`, `gql+be`.

Tell the user what you found:

> Change type: [CHANGE_TYPE] ([N] files changed)
> PR validation steps: [found / not found]
> Validation strategy: [Playwright / Rails runner / GQL queries / mixed]

## Step 4: Ensure Dev Server

### 4a. Check for running server

```bash
# Check if dev server process is running
pgrep -f "dev server" || pgrep -f "rails server" || pgrep -f "puma" || echo "NO_SERVER"
```

Also check if the app responds:

```bash
curl -sk -o /dev/null -w "%{http_code}" https://mozart.shop.dev/ 2>/dev/null || echo "NO_RESPONSE"
```

### 4b. Start server if needed

If no server is running, start one using the `bg_run` pi tool:

> `bg_run` with command `/opt/dev/bin/dev server` and cwd set to `$TARGET_DIR`

Then poll for readiness:

```bash
for i in $(seq 1 30); do
  curl -sk -o /dev/null -w "%{http_code}" https://mozart.shop.dev/ 2>/dev/null | grep -q "200\|302" && break
  sleep 2
done
```

Also check `bg_log` for "Listening" or startup errors.

Note whether you started the server (to mention in the PR comment).

## Step 5: Build and Execute Validation

### 5a. Frontend validation (chrome-devtools)

Use the `chrome_*` tools to drive the shared authenticated browser session. This avoids the auth problem — headless Playwright can't access `mozart.shop.dev` without session cookies, but the shared Chrome session is already logged in.

**Workflow:**

1. Use `chrome_list_pages` to see the current browser state
2. Use `chrome_new_page` to navigate to the target URL (`https://mozart.shop.dev/...`)
3. Use `chrome_wait_for` to confirm the page is loaded (wait for key text)
4. Use `chrome_take_snapshot` to inspect the page structure and get element `uid`s
5. Use `chrome_click` / `chrome_fill` to interact (using `uid`s from the snapshot)
6. Use `chrome_take_screenshot` with `filePath` to capture evidence at each key step

**Screenshot rules:**

- Save to `tmp/validation-artifacts-pr-<PR_NUMBER>/` with numbered prefixes: `01-initial-state.png`, `02-after-click.png`
- Take a screenshot at EVERY key validation step, not just start/end
- On failure, capture the current state before reporting
- Use `fullPage: true` for full-page captures

**Key rules:**

- Always `chrome_take_snapshot` before `chrome_click` or `chrome_fill` — stale `uid`s cause flaky interactions
- Use `chrome_wait_for` between navigation steps — don't race
- Use `chrome_list_console_messages` to check for JS errors after key interactions
- Log each step to the user so progress is visible during execution

**Collect artifacts:**
After validation, read the screenshots (the `read` tool supports images) to verify they show expected state. Include paths in the PR comment.

### 5b. Backend validation (Rails runner)

Create a disposable script at `tmp/validate-pr-<PR_NUMBER>.rb`.

**Script structure:**

```ruby
#!/usr/bin/env ruby
# frozen_string_literal: true

# Run: shadowenv exec -- bundle exec rails runner tmp/validate-pr-<PR_NUMBER>.rb

SLUG = "validate_pr_<PR_NUMBER>"

puts "=" * 60
puts "PR #<PR_NUMBER> Backend Validation"
puts "=" * 60

# --- Setup ---
puts "\n📦 Setup..."
# Create any deterministic test data needed
# Use find_or_create_by! with unique slug prefix

# --- Validate ---
puts "\n🔍 Validating..."
# Execute the behavior the PR claims to change
# Assert expected results
# Use raise/abort on failure

# --- Report ---
puts "\n📊 Results..."
# Print what was verified

puts "\n✅ All validations passed"
```

**Key rules:**

- If the PR description references test CSV files, fixture data, or any assets — use them in the script. Read the file paths from the diff to find them.
- Print progress for each step so the output is self-documenting
- Use `raise` or `abort` on validation failure (non-zero exit)

**Run:**

```bash
shadowenv exec -- bundle exec rails runner tmp/validate-pr-<PR_NUMBER>.rb
```

### 5c. GraphQL validation (GQL queries)

Create a disposable script at `tmp/validate-pr-<PR_NUMBER>-gql.rb`.

**Script structure:**

```ruby
#!/usr/bin/env ruby
# frozen_string_literal: true

# Run: shadowenv exec -- bundle exec rails runner tmp/validate-pr-<PR_NUMBER>-gql.rb

SLUG = "validate_pr_<PR_NUMBER>"

puts "=" * 60
puts "PR #<PR_NUMBER> GraphQL Validation"
puts "=" * 60

# --- Setup ---
puts "\n📦 Setup..."
# Create deterministic test data needed for the query/mutation

# --- Execute GQL ---
puts "\n🔍 Executing GraphQL..."

# Discover the schema class:
#   grep -r "< GraphQL::Schema" app/graphql/ --include="*.rb"
# Discover context shape:
#   grep -r "def context" app/controllers/ --include="*.rb" -A5
#   or look at existing GQL tests for context patterns
#
# Example (replace with actual schema class and context):
result = YourApp::Schema.execute(<<~GQL, variables: { ... }, context: { current_user: user, current_shop: shop })
  query {
    ...
  }
GQL

puts JSON.pretty_generate(result.to_h)

# Assert expected results
data = result.dig("data", "...")
raise "Expected X but got #{data}" unless data == expected

# For mutations:
mutation_result = YourApp::Schema.execute(<<~GQL, variables: { input: { ... } }, context: { current_user: user, current_shop: shop })
  mutation($input: ...Input!) {
    ...(input: $input) {
      ...
      userErrors { field, message }
    }
  }
GQL

errors = mutation_result.dig("data", "...", "userErrors")
raise "Mutation returned errors: #{errors}" if errors&.any?

puts "\n✅ All GraphQL validations passed"
```

**Key rules:**

- Use the actual GraphQL schema class from the codebase (find it via grep)
- Construct realistic context objects (current_user, shop, etc.)
- For mutations: verify both success AND that userErrors is empty
- For queries: verify the shape and content of returned data
- Print the full GQL response for evidence

**Run:**

```bash
shadowenv exec -- bundle exec rails runner tmp/validate-pr-<PR_NUMBER>-gql.rb
```

### 5d. Handle execution failures

If the script exits non-zero, distinguish between:

- **Validation failure** (the code ran but assertions failed) — the output contains "Expected", "raise", "❌", or assertion-style messages. This is a valid result — proceed to Step 6 and report the failure.
- **Environment failure** (the script couldn't run) — the output contains "LoadError", "ModuleNotFoundError", "PendingMigrationError", "command not found", or stack traces before any validation logic ran. This means the environment isn't ready, not that the code is wrong.

For environment failures:

1. Read the error message and try to fix it (e.g., `rails db:migrate`, `npm install`, `dev up`)
2. Retry the script once after the fix
3. If it still fails, report "Could not validate — environment error" in the PR comment with the error details. Do not report it as a test failure.

## Step 6: Cross-check PR Description Against Results

After running validation, compare:

### 6a. Accuracy of claimed steps

For each validation step in the PR description:

- **Confirmed** — the behavior matches what was claimed
- **Inaccurate** — the behavior differs from the claim (note how)
- **Untestable** — the step can't be validated in this environment (explain why)
- **Missing from PR** — a behavior you validated that the description doesn't mention

### 6b. Asset verification

If the PR references test files (CSVs, fixtures, etc.):

- Verify the files exist in the branch
- Verify they contain the expected data
- Use them in validation (don't create synthetic data when real test data is provided)

## Step 7: Draft PR Comment

Compose a top-level PR comment with the full validation results.

**Format:**

````markdown
## Manual Validation — PR #<NUMBER>

**Change type:** [FE / BE / GQL / Mixed]
**Validation method:** [Playwright / Rails runner / GQL queries / Mixed]
**Server:** [Already running / Started for validation]
**Branch:** `<HEAD_BRANCH>` at `<short SHA>`

### Results

| Step | Description        | Result                   |
| ---- | ------------------ | ------------------------ |
| 1    | [step description] | ✅ Pass                  |
| 2    | [step description] | ✅ Pass                  |
| 3    | [step description] | ❌ Fail — [brief reason] |

### PR Description Accuracy

- [N] of [M] claimed validation steps confirmed accurate
- [List any inaccuracies or missing steps]

### Evidence

[For FE: inline screenshots or link to artifact paths]
[For BE/GQL: relevant output excerpts]

<details>
<summary>Validation script</summary>

```[rb|ts]
[full script contents]
```

**Run command:**

```bash
[exact command to reproduce]
```

</details>

<details>
<summary>Full output</summary>

```
[stdout/stderr from the validation run]
```

</details>
````

**Key rules for the comment:**

- The script goes in a folded `<details>` block — don't clutter the main view
- Include the exact run command so anyone can reproduce
- For Playwright: embed or reference key screenshots (first, last, any failure)
- For BE/GQL: include the most relevant output lines, not the full dump
- Be honest about failures — a failed validation is valuable information

### Present the draft to the user

Show the full draft comment and ask:

> Here's the validation comment draft. Want me to:
>
> 1. **Post it** — I'll submit it as a PR comment via `gh`
> 2. **Edit first** — tell me what to change
> 3. **Just save it** — I'll write it to `tmp/pr-<NUMBER>-validation-comment.md`

**If the user says post it:**

```bash
gh pr comment <PR_NUMBER> --body-file tmp/pr-<NUMBER>-validation-comment.md
```

## Constraints

- Always check out the PR branch before validation — never validate against main
- Always verify the dev server is running before executing validation
- Never modify the PR's code — you are validating, not fixing
- Do NOT clean up test data — the local database is regularly reset. Skip cleanup logic entirely.
- Keep validation scripts in `tmp/` — they are disposable
- If validation fails, still draft the comment — a failure report is useful
- If the PR description has no validation steps, derive them from the diff and note "Validation steps derived from code changes (none in PR description)"
