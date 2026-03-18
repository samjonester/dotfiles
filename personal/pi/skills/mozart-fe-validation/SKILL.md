---
name: mozart-fe-validation
description: Validate Mozart frontend changes with disposable Playwright scripts and human-auditable artifacts (screenshots, ARIA snapshots, logs). Use when generating Mozart PR descriptions for frontend changes and when a PR needs reproducible FE validation steps.
---

# Mozart FE Validation (Disposable Playwright)

Use this when frontend/UI behavior needs proof a human can audit quickly.

## Output Requirements (always)

For every validation run, produce all of the following:

1. The exact disposable script used (`tmp/validate-*.ts`)
2. Exact command used to run it
3. Pass/fail output
4. Artifact file paths (screenshots + ARIA snapshot + optional console/network logs)
5. Data setup + cleanup commands (if any)

## 1) Preflight

Run from `//areas/platforms/mozart`.

### 1a. Check services

```bash
/opt/dev/bin/dev ps -n .
/opt/dev/bin/dev ps 2>&1 | grep shared
```

If required services are not running, stop and ask user to run `/opt/dev/bin/dev up`.

### 1b. Ensure dev server step is in PR validation

Always include a PR step:

```bash
/opt/dev/bin/dev server
```

If server is already running, still mention it in PR validation steps.

## 2) Seed deterministic data (when needed)

Prefer existing scenario tasks first:

```bash
bundle exec rake scenario:setup:marketer
bundle exec rake scenario:setup:contacts
bundle exec rake scenario:setup:journey
bundle exec rake scenario:setup:paid_ads
```

Cleanup with matching reset task:

```bash
bundle exec rake scenario:reset:marketer
bundle exec rake scenario:reset:contacts
bundle exec rake scenario:reset:journey
bundle exec rake scenario:reset:paid_ads
```

If no scenario exists, create a temporary Rails runner script in `tmp/` with explicit setup/cleanup.

## 3) Write disposable Playwright script

Create: `tmp/validate-<slug>.ts`

Requirements:
- Use `@playwright/test` library API (`chromium`), not long-lived test files.
- Default to `BASE_URL=https://mozart.shop.dev`.
- Use `ignoreHTTPSErrors: true`.
- Capture:
  - full-page screenshot to `tmp/validation-artifacts/`
  - ARIA snapshot to `tmp/validation-artifacts/`
  - console errors (fail if present unless explicitly expected)
- Exit non-zero on validation failure.

## 4) Run

```bash
shadowenv exec -- npx playwright install chromium
shadowenv exec -- BASE_URL=https://mozart.shop.dev npx tsx tmp/validate-<slug>.ts
```

## 5) PR description format

Add a **Frontend Validation** section with:

- `dev server` step
- optional seed setup/reset steps
- script body (copy/paste in code block)
- run command
- expected success output
- produced artifact paths

Template:

````markdown
### Frontend Validation

1. Start app
   - `/opt/dev/bin/dev server`
2. Seed (if needed)
   - `bundle exec rake scenario:setup:marketer`
3. Run
   - `shadowenv exec -- BASE_URL=https://mozart.shop.dev npx tsx tmp/validate-campaign-title.ts`
4. Cleanup
   - `bundle exec rake scenario:reset:marketer`

#### Disposable script used
```ts
// paste tmp/validate-campaign-title.ts
```

#### Result
- ✅ Passed
- Artifacts:
  - `tmp/validation-artifacts/campaign-title-<ts>.png`
  - `tmp/validation-artifacts/campaign-title-aria-<ts>.json`
````

## 6) Cleanup policy

- Keep script/artifacts in `tmp/` unless user asks to commit persistent validation.
- `tmp/` is gitignored; this is expected for disposable runs.
