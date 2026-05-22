## Phase 2, Part 1 — Rubric Parser Consolidation & Normalization

Refactor rubric handling so there is one parser, one normalized format, and resilient handling of teacher variation. No user-visible behavior change for standard 100-point rubrics.

### 1. Single source of truth for the parser

Create `supabase/functions/_shared/rubricParser.ts` as the canonical parser. It will contain:
- `ParsedRubricCriterion`, `ParsedRubricResult` types (moved from `src/lib/rubricParser.ts`)
- `parseRubricCriteria()`, `formatParsedRubricForGrading()`, `rubricSignature()`
- A new `normalizeToPoints(parsed)` helper that returns criteria with `points` filled in for every criterion (see §2)
- All metadata blocklist, regexes, and helpers consolidated here
- Pure TypeScript only — no Deno or browser APIs — so it imports cleanly from both Vite and Deno

Rewire:
- `src/lib/rubricParser.ts` becomes a thin re-export: `export * from "../../supabase/functions/_shared/rubricParser";`
- `supabase/functions/grade-paper/index.ts` deletes its inline `parseRubricText` and the parts of `buildRubric` that duplicate logic; it imports `parseRubricCriteria` + `normalizeToPoints` from `_shared/rubricParser.ts` and adapts the result into its existing `ParsedRubric` shape. `parseQuickRubric` and `parseAutoScoreSettings` stay (different inputs).
- `supabase/functions/grade-ela/index.ts` imports `formatParsedRubricForGrading` from the shared module instead of relying on the pre-serialized string only.
- `src/types/rubric.ts`'s `parseRubricText` is updated to delegate to the shared parser (keeps the existing `Rubric` shape it returns for current callers).

After this change there is exactly one regex-based extractor in the repo.

### 2. Normalize points/percentages before prompting

Add `normalizeToPoints(parsed: ParsedRubricResult): ParsedRubricResult`:
- If `totalPoints` is known, every `weight%` criterion → `points = round(weight/100 * totalPoints)`.
- If totals are missing and weights sum to 100, treat total as 100.
- If mixed (some points, some %) and total is ambiguous, log a warning, set total = sum of stated points, and pro-rate the % entries against that total.
- Resulting criteria always have `points` set, `weight` cleared.

Update `formatParsedRubricForGrading` to call `normalizeToPoints` first and emit only points:
```
Teacher-provided rubric criteria (validated extraction)
Total Points: 100
- Thesis / Central Claim: 25 points — ...
```
Never emits `%`.

The display layer (`RubricComplianceCard`, `ScoringOptionsSection`) keeps showing original weights — pass the un-normalized `parsed` to UI, the normalized version only to the model.

### 3. Teacher rubric variation handling

In the shared parser:
- **Non-100 totals**: already supported via `explicitTotal`. Audit `grade-paper`/`grade-ela` prompts and UI to remove any "/100" hardcoding; ensure score line uses `{earned}/{totalPoints} ({percent}%)`.
- **Variable criteria counts (2–10)**: replace any 4-criterion assumptions. The post-model validator in `_shared/gradingValidators.ts` already counts criteria dynamically; verify and remove any `=== 4` checks.
- **Decimal weights**: change regexes from `\d{1,3}` to `\d{1,3}(?:\.\d+)?` for both points and percent patterns, and parse with `parseFloat`. Total can stay integer (rounded).
- **Mixed performance levels (5-level, named, numeric 4/3/2/1)**: extend level detection. When >4 levels or non-standard names are detected, set `parsed.levelMappingAmbiguous = true` and add an issue note. UI surfaces this in the confirm step.
- **Extra-credit lines**: detect `bonus|extra credit|^\+\d` and mark criterion `isBonus: true`. Exclude bonus from `totalPoints`. Pass to model as a separate "Bonus opportunities" block. Validator allows scores >100% only when bonus is present.

### 4. Confirm-rubric step improvements

Update `RubricComplianceCard` (or the confirm gate in `GradePapers.tsx`, whichever owns the pre-grading preview) to render:
- Total points (with origin: explicit / summed / weighted-100)
- Per-criterion: name, points (and original weight in muted text if normalized), description
- A "Notices" section that prints any `issues[]` plus new structured notices:
  - "Treated 'Bonus: 5 pts' as extra credit"
  - "We couldn't determine a total — summed criteria to {N} points"
  - "Detected {N} performance levels — mapped to our 4-level scale" with a review link

Notices come from the shared parser; the UI is presentation-only.

### 5. Verification

- Run typecheck + existing Vitest suite.
- Add a small Vitest file `src/lib/__tests__/rubricParser.test.ts` covering: 100-pt rubric (Maya Chen sample), 50-pt rubric, decimal weights (12.5%/22.5%), 2-criterion + 10-criterion, 5-level rubric, bonus line.
- Manually invoke `grade-paper` via `supabase--curl_edge_functions` with the Maya Chen rubric and confirm the serialized rubric in the function log shows points only (no `%`), and total remains 100.
- Manually invoke with a 50-point rubric and confirm `totalPoints: 50` flows through to the response.

### Files touched
- **new** `supabase/functions/_shared/rubricParser.ts`
- **new** `src/lib/__tests__/rubricParser.test.ts`
- **edit** `src/lib/rubricParser.ts` (becomes re-export)
- **edit** `src/types/rubric.ts` (delegate `parseRubricText`)
- **edit** `supabase/functions/grade-paper/index.ts` (remove inline parser, import shared, drop /100 assumptions)
- **edit** `supabase/functions/grade-ela/index.ts` (import shared formatter, drop /100 assumptions)
- **edit** `src/components/RubricComplianceCard.tsx` (notices + non-100 totals)
- **edit** `src/pages/GradePapers.tsx` (pass normalized rubric to model, original to UI; surface notices)

### Risk / non-goals
- `parseQuickRubric` and `parseAutoScoreSettings` in `grade-paper` stay — they handle different input shapes (UI-collected, not freeform text).
- No grading-model prompt rewrites beyond the rubric block format change.
- No new UI for editing the parsed rubric inline — that's Phase 2 part 2.
