## Code Review: [PR Title/Number or Branch Name]

[Source URL if PR]

### Executive Summary

[One paragraph: overall assessment, key concerns, recommendation]

### Validation Summary

[From review-judge: how many findings survived validation, how many were filtered, confidence level]

### Critical Issues (MUST FIX)

[Merged from all reviewers, validated by judge, ordered by impact]

1. **[Issue Title]** (from: [reviewer(s)])
   - **Severity:** CRITICAL
   - **Location:** `file:lines`
   - **Problem:** [validated description]
   - **Current Code:** [snippet]
   - **Fix:** [snippet — confirmed working by judge]
   - **Impact:** [what goes wrong if unfixed]
   - **Confidence:** High/Medium

### Major Issues (SHOULD FIX)

[HIGH severity findings, validated]

### Improvements (CONSIDER)

[MEDIUM findings, grouped by theme]

### Minor / Follow-up

[LOW findings, quick list]

### Filtered Findings

[Findings the judge rejected as false positives, with brief reasons. Collapsed by default.]

---

### Specialist Reports

#### PR Scope & Size

[✅/⚠️/🚨 verdict line first]
[From review-scope]

#### Architecture & Design

[✅/⚠️/🚨 verdict line first]
[From review-architecture]

#### Security

[✅/⚠️/🚨 verdict line first]
[From review-security]

#### Performance & Scalability

[✅/⚠️/🚨 verdict line first]
[From review-performance]

#### Correctness & Logic

[✅/⚠️/🚨 verdict line first]
[From review-correctness]

#### Null Safety

[✅/⚠️/🚨 verdict line first]
[From review-nullsafety]

#### Testing & Quality

[✅/⚠️/🚨 verdict line first]
[From review-testing]

#### Operational Readiness

[✅/⚠️/🚨 verdict line first]
[From review-operations]

#### Shopify Conventions

[✅/⚠️/🚨 verdict line first]
[From review-shopify]

#### Design Context

[✅/⚠️/🚨 verdict line first]
[From review-design]

#### Simplification

[✅/⚠️/🚨 verdict line first]
[From review-simplify]

#### Consistency

[✅/⚠️/🚨 verdict line first]
[From review-consistency]

#### Naming

[✅/⚠️/🚨 verdict line first]
[From review-naming]

#### Readability

[✅/⚠️/🚨 verdict line first]
[From review-readability]

#### Intent Alignment

[✅/⚠️/🚨 verdict line first]
[From review-intent — only when SOURCE_TYPE=pr. Omit for local reviews.]

<!-- For any user-defined review-* agent not listed above (e.g., review-accessibility, review-i18n), add a section here using the agent's short name as the heading. -->

---

### Positive Highlights

[Aggregated from all reviewers — good patterns, clever solutions]

### Learning Opportunities

[One paragraph of constructive mentoring for the author]

### Risk Assessment

- **Production Risk:** [LOW/MEDIUM/HIGH]
- **Rollback Plan:** [Adequate/Needs improvement]
- **Monitoring:** [Sufficient/Gaps identified]
- **Feature Flags:** [Properly gated/Missing guards]

### Decision

**Verdict:** [APPROVE / REQUEST CHANGES / DISCUSS / BLOCK]
**Confidence Level:** [High/Medium/Low — informed by judge validation rate]
**Follow-up Required:** [Yes/No — specify what]
