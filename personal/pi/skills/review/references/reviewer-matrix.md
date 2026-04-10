# Reviewer Selection Matrix

Map PR characteristics to the right set of reviewers. The classifier uses this matrix to select **core** (always run) and **optional** (run if PR is medium+ size) reviewers.

## Classification Axes

### Language detection (from file extensions in diff)

| Extensions | Language |
|---|---|
| `.rb`, `.rake`, `.gemspec` | ruby |
| `.ts`, `.tsx`, `.js`, `.jsx` | typescript |
| `.yml`, `.yaml` | yaml |
| `.graphql`, `.gql` | graphql |
| `.erb`, `.html`, `.slim` | template |
| `.css`, `.scss`, `.less` | style |
| Mixed (2+ languages) | mixed |

### Change type detection (from diff content + PR metadata)

Evaluate in order — first match wins:

1. **config-ci** — All files are YAML/config, GitHub Actions workflows, CI configs, Dockerfiles, Makefiles
2. **migration** — Contains DB migration files (`db/migrate/`, `schema.rb`, `structure.sql`)
3. **gql-schema** — Primary changes are `.graphql` files or GraphQL type/resolver definitions
4. **test-only** — All changed files are in `test/`, `spec/`, `__tests__/`, or `*_test.*`
5. **service-extraction** — New service/module files with corresponding deletion from existing files (moved code)
6. **bug-fix** — PR title/branch contains "fix", "bugfix", "hotfix", or diff is small + touches specific logic
7. **feature** — New files added, new routes/endpoints, significant additions
8. **refactor** — Net deletion or neutral, restructuring existing code
9. **dependency** — Lockfile changes, gem/package updates
10. **general** — Fallback

### Size classification (reviewable lines from Step 2b)

| Size | Lines | Batch limit |
|---|---|---|
| tiny | <50 | 5 |
| small | <200 | 3 |
| medium | <500 | 2 |
| large | 500+ | 1 |

### Risk signals (additive — check all)

- `risk:auth` — Touches authentication, authorization, session, or permission files
- `risk:data` — Touches DB migrations, data models, or data pipeline code
- `risk:money` — Touches billing, payments, pricing, or financial calculations
- `risk:api` — Touches public API endpoints, GraphQL schema, or webhook handlers
- `risk:infra` — Touches deploy configs, infrastructure, or operational tooling

## Reviewer Mapping

### By change type

| Change type | Core (always) | Optional (medium+) |
|---|---|---|
| config-ci | scope, operations, security | intent |
| migration | correctness, operations, scope | architecture, shopify |
| gql-schema | scope, correctness, architecture | operations, shopify, intent |
| test-only | scope, testing | simplify |
| service-extraction | architecture, design, correctness, scope | naming, consistency, simplify |
| bug-fix | correctness, scope, testing | design, nullsafety |
| feature | scope, correctness, architecture, testing | design, readability, performance |
| refactor | architecture, scope, simplify | design, consistency, naming |
| dependency | scope, security, operations | — |
| general | scope, correctness, architecture, testing | design, readability |

### Risk signal escalation

When risk signals are present, add these reviewers to core (if not already included):

| Risk signal | Add to core |
|---|---|
| risk:auth | security |
| risk:data | correctness, operations |
| risk:money | correctness, testing, security |
| risk:api | architecture, operations |
| risk:infra | operations, security |

### Size-based adjustments

- **tiny** (<50 lines): Run core only. Skip optional entirely. Skip judge if core produces 0 findings (just report clean).
- **small** (<200 lines): Run core only. Run optional only if core produces 3+ findings (suggests complexity).
- **medium** (<500 lines): Run core + optional.
- **large** (500+ lines): Run core + optional + always include `intent` (large PRs drift from stated goals).

## Override rules

1. **User-specified subset** always wins — if the user says "just security and performance", use exactly those regardless of classification.
2. **Always include `scope`** unless the user explicitly excludes it — it catches PR hygiene issues that other reviewers miss.
3. **Never include `review-judge` in reviewer dispatch** — the judge runs separately after all reviewers complete.
4. **Custom `review-*` agents** (not in the matrix) are always included in the optional set.
