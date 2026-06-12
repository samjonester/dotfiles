---
name: mozart-blog-url-generation
description: Bulk-create Mozart ads from a list of Shopify blog URLs. Creates a PaidAdsProject ad folder and, for each URL, scrapes the page, polls until done, and submits an ad generation request. Use when the user asks to "generate ads from these blog URLs", "bulk create Mozart ads from a list", "create an ad folder from these URLs", "make ads for all of these blog posts", or any request involving a list of `*.shopify.com` URLs and Mozart ad creation.
---

# Mozart Blog URL Ad Generation

## Prerequisites

This skill drives the **Mozart MCP server**. Install + connect it before using the skill — installing the skill alone does not install the server.

- **Endpoint:** `https://mozart.shopify.io/mcp?crud=true&analytics=true` (auth: Mozart session token)
- **Claude Code / Cursor / Codex:** `claude mcp add mozart https://mozart.shopify.io/mcp?crud=true&analytics=true` (or equivalent for your client), then complete the Mozart auth flow
- **Pi:** install the `mozart-mcp` extension from `shopify-playground/shop-pi-fy` and run `/mozart-mcp-auth`

**Verify the connection** by calling `get_ad_taxonomy` (no args). It should return a `{platforms, cta_types, business_lines, markets, ...}` payload. If you see `Authentication required`, finish the auth step before proceeding.

---

Drive Mozart's MCP tools to take a list of `*.shopify.com` blog URLs and end up with one in-flight `GenerationRequest` per URL inside a single ad folder. The skill is a thin dispatcher — Mozart owns the heavy work (scrape jobs on hedwig, generation workflows on Temporal). Your job is to compose the tools correctly, keep state on disk, and surface progress to the user.

## Required tools

- `get_ad_taxonomy` — once, up front (auth + taxonomy preflight; see below)
- `create_ad_folder` — once, up front
- `create_scrape_request` — per URL kickoff
- `get_scrape_status` — poll
- `create_generation_request` — per scraped page
- `get_generation_request_status` — optional poll

## Auth + taxonomy preflight (run BEFORE anything else)

**One call does both jobs.** Before any writes, call `get_ad_taxonomy` (no args) exactly once at session start. It is gated by `current_shopifier` (so it doubles as the auth check) and returns the canonical taxonomy bundle, all from in-process Ruby constants — zero DB round-trips, much cheaper than the previous `list_ad_folders` preflight.

Do not also call `list_ad_folders` for auth — the taxonomy call has already verified authentication.

On `Authentication required` error, **abort the run immediately** and tell the user:

> "Mozart MCP not authenticated; check your token. (No ad folder was created, no URLs were scraped.)"

On success, **cache the response payload** as `taxonomy` for the entire run. Shape:

```json
{
  "platforms": {
    "publishing_supported": ["meta", "google", "reddit", "pinterest", "tiktok"],
    "generation_supported": ["meta", "google"]
  },
  "cta_types": { "supported": ["LEARN_MORE", "SIGN_UP", ...], "default": "SIGN_UP" },
  "business_lines": [...],
  "markets": [...],
  "creative_tactics": [...],
  "sources": [...],
  "languages": [...]
}
```

### Validation rules (use the cached `taxonomy` for ALL of these)

Validate every user-supplied enum value against the matching list in `taxonomy` **before** issuing any write. On invalid input, error with a message that **prints the actual valid values from the cached payload** — not a hardcoded list in this skill.

| Input           | Validate against                          | Example error                                                                                              |
| --------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `platform`      | `taxonomy.platforms.generation_supported` | `"platform 'reddit' not valid. Valid values: meta, google"` (reject reddit/pinterest/tiktok up front — they appear in `taxonomy.platforms.publishing_supported` but generation-only supports meta/google) |
| `cta_type`      | `taxonomy.cta_types.supported`            | `"cta_type 'BUY_NOW' not valid. Valid values: LEARN_MORE, SIGN_UP, INSTALL_MOBILE_APP, CONTACT_US, START_FOR_FREE"` |
| `business_line` | `taxonomy.business_lines`                 | `"business_line 'Foo' not valid. Valid values: Audience Priming, Reach Expansion, Replatformer, Retail, Standard, Upmarket"` |
| `market`           | `taxonomy.markets`                        | `"market 'XX' not valid. Valid values: AU, AU&UK&IE, BR, CA, ..."`                                         |
| `creative_message` | `taxonomy.creative_tactics`               | `"creative_message 'INVALID' not valid. Valid values: BLOG, TESTIMONIAL, ..."` |
| `source`           | `taxonomy.sources`                        | `"source 'BAD' not valid. Valid values: TOOLS_AI, ..."` (note: backend accepts arbitrary strings, but validate against common values for consistency) |

Do not hardcode any of these allowed-value lists in skill logic. The concrete defaults shown elsewhere in this skill (`meta`, `LEARN_MORE`, etc.) are illustrative — always re-confirm them against the cached `taxonomy` at runtime.

## Inputs to gather from the user

Valid options for every enum-shaped input below come from the cached `taxonomy` returned by `get_ad_taxonomy`, not from a hardcoded list in this skill. Always validate user input against `taxonomy` and reject with an error that prints the actual allowed values from the cached payload (see Validation rules above).

**Minimize what you ask for.** The first three rows plus `business_line` and `market` are required — everything else has a sensible default for the blog-URL flow. Don't ask about optional inputs unless the user volunteers them.

| Input             | Required | Default                | Notes                                                                                                                                                                                                            |
| ----------------- | -------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| List of blog URLs | yes      | —                      | Accept paste, file path, or interactive prompt. **Filter client-side**: `URI.parse(url).scheme == "https" && uri.host.end_with?("shopify.com")`. Print rejected URLs back, ask whether to proceed with the rest. |
| Folder name       | yes      | —                      | string                                                                                                                                                                                                           |
| Platform          | yes      | —                      | User picks from `taxonomy.platforms.generation_supported` (currently `["meta", "google"]`). Reject any other value (including `reddit`/`pinterest`/`tiktok`, which appear in `taxonomy.platforms.publishing_supported` but are not supported for generation) with a clear error listing allowed values.                                            |
| business_line     | yes      | —                      | **Required by MCP tool.** User picks from `taxonomy.business_lines`. Validate against the cached taxonomy; reject anything not in the list with a clear error listing allowed values.                             |
| market            | yes      | —                      | **Required by MCP tool.** User picks from `taxonomy.markets`. Validate against the cached taxonomy; reject anything not in the list with a clear error listing allowed values.                                    |
| Languages         | no       | `["en"]`               | Per-language config defaults to `cta_button_text="Learn more"`, `button_url=` scrape's `localized_urls[lang]` if present, else the canonical blog URL. Only ask if the user wants additional languages.        |
| cta_type          | no       | `LEARN_MORE`           | Validate against `taxonomy.cta_types.supported`; reject anything not in the list with a clear error listing allowed values. (Default `LEARN_MORE` differs from the tool's generic `taxonomy.cta_types.default` of `SIGN_UP` because blog-URL ads almost always read better with "Learn more".)                       |
| concept_title     | n/a      | scraper-provided       | **Always sourced from the scrape** (blog `<h1>` via `get_scrape_status.concept_title`). Don't ask the user.                                                                                                      |
| creative_message  | n/a      | `"BLOG"`               | **Always send `"BLOG"` for this skill** — source content is blog by definition. Don't ask the user. This field is **required by the MCP tool**; hardcode it. Gates `AdAssetTemplate.select_for` template selection; passing `"BLOG"` explicitly avoids edge cases in older code paths that call `creative_message.upcase`. |
| source            | n/a      | `"TOOLS_AI"`           | **Always send `"TOOLS_AI"` for this skill** — content is AI-generated via tooling. This field is **required by the MCP tool**; hardcode it. Don't ask the user.                                                |
| prompt_context    | optional | scrape's `page_context`| If user provides extra context, prepend to each per-URL `page_context` before submission. Otherwise just send `page_context` from the scrape.                                                                  |

## Per-URL state machine

For each URL in the validated list:

```
state: NEW
  → create_scrape_request(url)
    → on success: store scrape_id, transition to SCRAPING
    → on rate_limited: backoff (see Error surfacing), stay NEW
    → on URL validation failure: transition to FAILED with reason

state: SCRAPING
  → poll get_scrape_status(scrape_ids: [...all SCRAPING ids]) every 5s
    Use ONE bulk call per cycle covering every in-flight scrape; do NOT fan out
    per-id polls. Iterate the `results` array, transitioning each id by status:
    → status=pending: stay SCRAPING
    → status=failed: transition to FAILED, store error
    → status=completed && signed_blob_id=null: transition to FAILED with "og_image_unavailable"
    → status=completed && signed_blob_id present: transition to SCRAPED
    → error="not_found" (per-element): treat as FAILED with "unauthorized_or_missing"
      — should never happen during a normal run since the skill creates the rows itself

state: SCRAPED
  → create_generation_request(project_id, signed_blob_id, ...)
    using:
      concept_title = scrape.concept_title  # always from scraper
      creative_message = "BLOG"              # always — this skill only handles blog URLs
      source = "TOOLS_AI"                    # always — content is AI-generated via tooling
      prompt_context = (user's prompt_context if any) + "\n" + scrape.page_context
      cta_type = user input or "LEARN_MORE" default
      business_line = user input (required)   # validated against taxonomy
      market = user input (required)          # validated against taxonomy
      language_configurations[] defaults:
        - language: "en"
        - cta_button_text: "Learn more"
        - button_url: scrape.localized_urls[lang] || scrape.url
    → on success: store generation_request_id, transition to GENERATING
    → on rate_limited: backoff, stay SCRAPED
    → on validation failure: transition to FAILED with reason

state: GENERATING (terminal for default skill mode — agent has done its job)
  Optional: if user requested in-line generation tracking:
    → poll get_generation_request_status(gr_id) every 10s
      → status=in_progress: stay GENERATING
      → status=completed: transition to DONE
      → status=failed: transition to FAILED with reason
```

## Progress reporting

Lightweight, in-conversation, per-pass. **No file output unless the user asks for one.**

Print every ~5 URLs of progress, plus on every state transition for failures:

```
Scraping: 12/100 (✅ 10 completed, ⏳ 2 in flight, ❌ 0 failed)
Generating: 8/100 submitted (folder: https://mozart.shopify.com/ad-folders/12345/edit)
Last failure: https://www.shopify.com/blog/foo-bar — og_image_unavailable
```

Keep it terse — agent context budget matters.

## Concurrency strategy

**Sequential kickoffs, bulk polling.** Rate limits are surfaced per-tool in the
MCP tool descriptions; trust those rather than maintaining a local table here —
bumping a cap in code automatically updates the description.

- Issue `create_scrape_request` calls serially, ~1/sec. The cap (advertised in
  the tool description) is calibrated for that pace; no client-side parallelism
  is needed.
- **Bulk-poll** scrape status: ONE `get_scrape_status` call per polling cycle
  with ALL in-flight scrape ids in `scrape_ids: [...]`. The tool accepts up to
  200 ids per call — enough to cover the realistic worst-case in-flight set
  in a single call. Repeat every ~5s. Do NOT fan out per-id polls.
- Issue `create_generation_request` calls serially. The cap (advertised in the
  tool description) is the throttle here, not just an abuse ceiling — generation
  is expensive (Temporal workflow + AI inference).
- **Bulk-poll** generation status the same way: ONE `get_generation_request_status`
  call per cycle with ALL in-flight ids in `generation_request_ids: [...]`,
  every ~10s.

In short: kickoff is cheap and serial; the skill's wall-clock is dominated by
scrape duration (~10s/URL) and generation duration (minutes — but the skill
typically returns at SCRAPED → GENERATING and lets Mozart finish async).

The actual scraping happens on hedwig regardless of skill concurrency — the skill is just a dispatcher.

## Resume / failure semantics

**Local checkpoint file at `/tmp/mozart-blog-bulk-<folder_id>.json`.**

Schema:

```json
{
  "folder_id": 12345,
  "platform": "meta",
  "created_at": "2026-04-29T10:00:00Z",
  "shared_inputs": { "cta_type": "LEARN_MORE", "business_line": "Standard", "market": "US", "creative_message": "BLOG", "source": "TOOLS_AI" },
  "urls": [
    {
      "url": "https://www.shopify.com/blog/foo",
      "scrape_id": 9876,
      "generation_request_id": 4242,
      "state": "GENERATING",
      "error": null
    },
    {
      "url": "https://www.shopify.com/blog/bar",
      "scrape_id": 9877,
      "generation_request_id": null,
      "state": "FAILED",
      "error": "scrape_failed: 404 from https://..."
    }
  ]
}
```

Write the checkpoint **after every state transition**.

**Resume mode** triggered by `--resume <folder_id>` or natural-language "resume my bulk run for folder 12345":

- Read checkpoint. For each URL still in NEW/SCRAPING/SCRAPED/GENERATING, re-poll the relevant `get_*_status` tool to refresh state.
- For NEW: issue `create_scrape_request`.
- For SCRAPING with a known `scrape_id`: re-poll.
- For SCRAPED: issue `create_generation_request`.
- For GENERATING: re-poll if the user wants in-line tracking; else consider done.

**Idempotency caveat**: the MCP tools themselves are not idempotent. If the skill thinks `state=NEW` but in fact a scrape was created in the previous run before the crash, it will create a duplicate. Mitigation: write the checkpoint **before** the kickoff call, marking the URL as `IN_FLIGHT`. On resume, IN_FLIGHT URLs are first re-checked. Acceptable trade-off: duplicate scrapes are cheap (separate `ScrapedPage` rows, separate hedwig jobs); pick the most recently completed one.

## Error surfacing

| Class                | Examples                                                    | Skill action                                                                                |
| -------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| URL-level            | scrape failed, `og_image_unavailable`, invalid URL          | Log to checkpoint, mark FAILED, **continue** to next URL                                    |
| Tool-level transient | `Rate limit exceeded`, 5xx response, network timeout        | Exponential backoff: 1s, 2s, 4s, 8s. Retry same URL. After 4 retries → mark FAILED.         |
| Auth                 | Missing `current_shopifier`, 401/403                        | **Abort** the run. Print "Mozart MCP not authenticated; check your token". Save checkpoint. |
| Permission           | "You don't have permission to generate ads for this folder" | **Abort** — config error, retrying won't help.                                              |

## Final report

At end of run (or on `Ctrl+C` / abort, with as-much-as-completed):

```
✅ Mozart Blog URL Ad Generation — complete

Folder: Spring Blog Ads (meta)
URL: https://mozart.shopify.com/ad-folders/12345/edit

Total URLs:        100
  Submitted:        92  (generation in flight on Temporal)
  Failed:            8

Failed URLs:
  https://www.shopify.com/blog/foo  →  og_image_unavailable
  https://www.shopify.com/blog/bar  →  scrape_failed: 404
  ...

Submitted (sample):
  https://www.shopify.com/blog/intro-to-pos
    generation_request_id: 4242
    edit: https://mozart.shopify.com/ad-folders/12345/edit
  ... (full list in checkpoint /tmp/mozart-blog-bulk-12345.json)

Watch progress: https://mozart.shopify.com/ad-folders/12345/edit
```

Always end with the dashboard URL — that's where the user actually monitors the long-running generation work.

## Dependency call-out

**Verify Mozart MCP authentication before any writes.**

The `get_ad_taxonomy` preflight described above doubles as the auth check — it is gated by `current_shopifier` and reads only Ruby constants (no DB), making it the cheapest possible auth-gated call. If it errors with `Authentication required`, abort with a clear message.

If a dedicated `whoami` / ping tool lands later, prefer it. Until then, `get_ad_taxonomy` is the right preflight — it both validates auth and returns the taxonomy bundle the rest of the skill depends on, in a single round-trip.
