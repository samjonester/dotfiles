---
name: mozart-be-validation
description: Validate Mozart backend changes with disposable Rails runner scripts that an AI can execute end-to-end. Use when generating Mozart PR descriptions for backend changes and when PRs need reproducible BE validation steps.
---

# Mozart BE Validation (Disposable Rails Scripts)

Use this when backend behavior needs deterministic, rerunnable validation (without relying on manual Rails console typing).

## Output Requirements (always)

For every validation run, produce:

1. Script path + full script body
2. Exact setup/verify/cleanup commands
3. Actual command output (pass/fail)
4. Records created/checked/deleted
5. Any dependency on `dev server` and seed tasks

## 1) Preflight

Run from `//areas/platforms/mozart`.

### 1a. Check services

```bash
/opt/dev/bin/dev ps -n .
/opt/dev/bin/dev ps 2>&1 | grep shared
```

If required services are down, stop and ask user to run `/opt/dev/bin/dev up`.

### 1b. Ensure dev server step is in PR validation

Always include this in PR validation steps (even for BE-heavy changes):

```bash
/opt/dev/bin/dev server
```

If change is BE-only, note server start may be skipped during execution but must still be documented.

## 2) Prefer scripts over interactive console

Do **not** rely on manual `dev console` copy/paste as the primary validation path.

Instead, create a disposable script in `tmp/` and run it with `rails runner` so AI/humans can replay exactly.

## 3) Seeding strategy

### Preferred: existing scenario tasks

```bash
bundle exec rake scenario:setup:marketer
bundle exec rake scenario:setup:contacts
bundle exec rake scenario:setup:journey
bundle exec rake scenario:setup:paid_ads
```

Cleanup with matching reset task.

### If no scenario exists: local disposable seed logic

In the script, use deterministic records:
- unique prefix like `ai_validation_<slug>_...`
- `find_or_create_by!` where possible
- explicit cleanup branch to remove created data

## 4) Script shape (setup / verify / cleanup)

Create: `tmp/validate-<slug>.rb`

Template:

```ruby
#!/usr/bin/env ruby
# typed: strict
# frozen_string_literal: true

# NOTE: this script is executed with `bundle exec rails runner`,
# so Rails environment is already loaded.

mode = ARGV.fetch(0)
slug = "ai_validation_<slug>"

case mode
when "setup"
  # create deterministic records
  # puts what was created
when "verify"
  # run assertions; raise on failure
  # puts success details
when "cleanup"
  # delete created records
  # puts cleanup summary
else
  abort("Usage: rails runner tmp/validate-<slug>.rb [setup|verify|cleanup]")
end
```

## 5) Run commands

```bash
shadowenv exec -- bundle exec rails runner tmp/validate-<slug>.rb setup
shadowenv exec -- bundle exec rails runner tmp/validate-<slug>.rb verify
shadowenv exec -- bundle exec rails runner tmp/validate-<slug>.rb cleanup
```

If verify fails, cleanup still needs to run.

## 6) PR description format

Add a **Backend Validation** section containing:

- `dev server` step
- optional scenario setup/reset commands
- full disposable script
- exact run commands
- observed output

Template:

````markdown
### Backend Validation

1. Start app
   - `/opt/dev/bin/dev server`
2. Seed (if needed)
   - `bundle exec rake scenario:setup:contacts`
3. Run setup/verify/cleanup
   - `shadowenv exec -- bundle exec rails runner tmp/validate-contact-unsubscribe.rb setup`
   - `shadowenv exec -- bundle exec rails runner tmp/validate-contact-unsubscribe.rb verify`
   - `shadowenv exec -- bundle exec rails runner tmp/validate-contact-unsubscribe.rb cleanup`
4. Reset (if needed)
   - `bundle exec rake scenario:reset:contacts`

#### Disposable script used
```rb
# paste tmp/validate-contact-unsubscribe.rb
```

#### Result
- ✅ Verify passed
- ✅ Cleanup passed
````

## 7) Cleanup policy

- Keep these scripts in `tmp/` unless user asks for permanent test coverage.
- If behavior should be regression-protected long-term, convert script into real automated tests after validation.
