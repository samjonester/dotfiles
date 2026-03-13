# Personal Coding Preferences

## Tool Usage

- Never use `sed -n` to read file ranges — use the `read` tool with offset/limit parameters instead
- Never use `cat`, `head`, or `tail` to read files — use the `read` tool
- Never use `sed -i` for file edits — use the `edit` tool for surgical changes or `write` for full rewrites
- Prefer the native `grep`, `find`, and `ls` tools over their bash equivalents — they are faster, produce fewer tokens, respect .gitignore, and don't trigger bash-guard security reviews
- When exploring code, batch related reads into a single request when the files are independent

## Model & Thinking Selection

- **Code editing** (write, edit, refactor, implement features, fix bugs): always use Opus
- **Code reviews and architectural planning**: use Opus with high thinking
- **Mechanical tasks** (grep, find, read, file exploration, running tests, PR descriptions, git operations, renaming across files): use Sonnet with medium thinking
- **Simple substitutions and small edits** (renaming a variable, fixing a typo, updating a string): Opus is fine, but use medium thinking — high thinking is unnecessary
- When transitioning from a planning/review phase to an implementation phase, suggest switching to Sonnet for the mechanical parts
- After `/clear` or starting a new task in the same session, re-evaluate whether the current model is appropriate

## Session Hygiene

- Prefer starting new sessions (`/session new`) for unrelated tasks rather than using `/clear`
- `/clear` causes full cache misses — the entire context must be re-sent and re-cached, which is expensive at high context sizes
- If you must stay in the same session, be aware that accumulated context from earlier tasks inflates cost for later ones
- For long implementation sessions (>50 tool calls), suggest compacting with `/compact` if context is growing large

## Service Design

- Prefer pure service objects over shared behavior via inheritance, base classes, mixins, modules, or concerns. Each service should be self-contained and explicit about its dependencies.
- Services should return a Result object (e.g., `Result.success(...)` / `Result.failure(...)`) rather than raising exceptions. Raising should be reserved for callers that need it (e.g., Temporal activities), not the services themselves.

## Temporal Activities

- Only Temporal activities should raise Temporal errors (e.g., `ApplicationError`). Services used by activities may also be called from GraphQL resolvers, jobs, or other contexts — they must not raise Temporal-specific errors.
- When handling failures in Temporal activities, differentiate between retryable and non-retryable errors:
  - **Retryable**: intermittent issues like network timeouts, rate limits, transient API errors — let these propagate or raise a retryable `ApplicationError`
  - **Non-retryable**: permanent failures like auth errors (401/403), not found (404), invalid input, missing files — raise `Temporal::Error::ApplicationError.new("...", non_retryable: true)` so Temporal does not waste retries

## Workflow

- Clean up any `.md` files created during planning or task coordination at the end of each step. Do not defer cleanup until the end of a task.

## Git Safety

- Always highlight local git/graphite commands after executing them.
