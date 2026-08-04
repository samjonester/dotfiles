# Review Output Template

Fill this for the **in-chat / findings-file** report (Step 6). This is *not* the GitHub comment — that's Step 7a, and it is deliberately much shorter.

**Before you start:** the reader has seen none of the subagent output. Every entry must stand alone. See the zero-context rule in Step 6.

---

## [PR #N — Title] or [Branch Name]

[Source URL if PR] · head `[sha]` · [N files, +X/−Y]

**Pipeline:** [N] agents ([list]) + [`devx pair-review` (model, N findings) | agents only] → `review-judge`
**Reviewers:** [roster status line — ✅/❌ per reviewer, with captured errors]
**Funnel:** [N] raw findings → [N] distinct after merge → **[N] rejected**, [N] actionable

---

## 1. Rejected findings

> Render these **first**, in full, before anything actionable. They are the part the reader cannot reconstruct, and they are often the highest-value output of the pipeline. Never collapse, never summarize as a count.

### R[n]. [What was proposed] — [one-line reason it was rejected]

- **Filed by:** [source] as [severity]
- **Location:** `file:lines`
- **What they proposed:**
  ```[lang]
  [the actual suggested change]
  ```
- **Why it's rejected:** [the specific evidence that settles it — code read, test that already covers it, git history, call path traced]
- **Underlying concern:** [Still valid → promoted to finding #N] | [Not valid] | [N/A]

Lead with any rejection in these two classes and label it as such:

- **⚠️ Would have introduced a bug** — a "simplification" that breaks a boundary, a "fix" that inverts its own intent
- **⚠️ Would have deleted something load-bearing** — a comment carrying a non-obvious invariant, a duplication that preserves a11y or type semantics

For these, state plainly that the author should keep what they have.

---

## 2. Reclassification

> Show the arithmetic so the reader can audit the funnel. A silent drop is indistinguishable from an oversight.

```
[N] distinct findings → [N] surfaced
  [n] HIGH   → MEDIUM   [title] — [why downgraded]
  [n] MEDIUM → merged   into #[N] — [same root cause, N locations]
  [n] LOW    → dropped  [rule from review-calibration.md] — [which findings]
```

Name the calibration rule for every drop (`premature optimization`, `test coverage nits on non-critical paths`, `pre-existing N+1`, etc.).

---

## 3. Findings

> Grouped by **adjudicated** severity. Every entry self-contained.

### [SEVERITY] #[N]. [Title]

- **Severity:** [filed] → **[adjudicated]** [omit the arrow if unchanged]
- **Source:** `[agent]` | `[agent + agent + pair-review NNNN]` — **[N]-source convergence** | `pair-review NNNN, conf 0.NN`
- **Location:** `file:lines` [verified present at HEAD]
- **Problem:** [what is actually wrong — plain terms, no "reviewer X says"]
- **Impact:** [what breaks, degrades, or confuses; who notices]
- **Fix:**
  ```[lang]
  [concrete change]
  ```
- **Evidence:** [what was checked to validate — files read, tests found, call paths traced]
- **Confidence:** High / Medium / Low

Sections, in order — omit any that are empty rather than writing "none":

- **Blocking** (CRITICAL / HIGH)
- **Needs a decision** (findings that are correct but where the call is the user's — intended-behavior questions, product tradeoffs)
- **Should fix** (MEDIUM)
- **Nits** (LOW — fix now unless genuinely out of scope)

---

## 4. Disagreements

> Only when sources conflicted. Reviewers contradicting each other is signal — it usually means the call is genuinely a judgment call, and it belongs to the user.

### [Topic]

- **[Source A]** argued: [position]
- **[Source B]** argued: [position]
- **Judge checked:** [what was verified]
- **Resolution:** [outcome, and whether it's settled or still open for the user]

Include the case where pair-review's overall summary conflicts with a filed agent finding.

---

## 5. Verified strengths

> Not filler — only things confirmed against the code, and only where saying so has value: it tells the author what not to change, and it's what makes a review land as considered rather than adversarial.

- **[Strength]** — [what was verified and how]

---

## 6. Deferrals — need confirmation

> Render the argument *for* the deferred work fully enough that the reader can overrule you. Never bury a deferral in prose.

### D[n]. [Proposed work]

- **Argued by:** [source] as [severity/opportunity]
- **The case for it:** [the strongest version of the argument, including any evidence cited]
- **The case against doing it here:** [scope, risk, PR size, whether the evidence holds]
- **Recommendation:** [follow-up | fold in] — **your call**

---

## 7. Verdict

> **Last.** Never lead with this.

**[APPROVE | APPROVE WITH COMMENTS | REQUEST CHANGES | DISCUSS]**

Justify against the bar in `review-calibration.md` by naming the categories:

> REQUEST_CHANGES requires a correctness bug, security issue, contract violation, or missing error handling on a critical path. [Which apply / none remain, therefore …]

- **Confidence:** [High/Medium/Low — informed by judge validation rate and any reviewer failures]
- **Coverage gaps:** [any reviewer that failed, anything not verified]
