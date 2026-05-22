import { describe, it, expect } from "vitest";
import {
  parseRubricCriteria,
  normalizeToPoints,
  formatParsedRubricForGrading,
} from "@/lib/rubricParser";
import { fixtures } from "./fixtures/rubrics";

describe("shared rubricParser — targeted cases", () => {
  it("parses the Maya Chen 100-pt rubric (points only, total 100)", () => {
    const text = `Rubric
Total Points: 100
- Thesis / Central Claim: 25 pts — Clear, specific answer that directly addresses the prompt.
- Textual Evidence: 30 pts — Two or more relevant quotes from the passage.
- Analysis & Reasoning: 30 pts — Explanation of how evidence supports the claim.
- Conventions: 15 pts — Grammar, spelling, punctuation.`;
    const parsed = parseRubricCriteria(text);
    expect(parsed.status).toBe("valid");
    expect(parsed.criteria).toHaveLength(4);
    expect(parsed.totalPoints).toBe(100);
    expect(parsed.totalSource).toBe("explicit");
    const formatted = formatParsedRubricForGrading(parsed);
    expect(formatted).toContain("Total Points: 100");
    expect(formatted).toMatch(/25 points/);
    expect(formatted).not.toMatch(/%/);
  });

  it("normalizes percentages into points against the total", () => {
    const text = `Rubric
Total Points: 100
- Content: 40%
- Style: 60%`;
    const parsed = normalizeToPoints(parseRubricCriteria(text));
    expect(parsed.criteria[0].points).toBe(40);
    expect(parsed.criteria[1].points).toBe(60);
    expect(parsed.criteria[0].weight).toBeNull();
    const formatted = formatParsedRubricForGrading(parsed);
    expect(formatted).toMatch(/Content: 40 points/);
    expect(formatted).not.toMatch(/%/);
  });

  it("never serializes percentages to the model prompt", () => {
    for (const f of fixtures) {
      if (f.expected.status !== "valid") continue;
      const formatted = formatParsedRubricForGrading(parseRubricCriteria(f.input));
      expect(formatted, `fixture ${f.id}`).not.toMatch(/\d+%/);
    }
  });
});

describe("shared rubricParser — fixtures", () => {
  for (const fixture of fixtures) {
    it(`[${fixture.id}] ${fixture.description}`, () => {
      const parsed = parseRubricCriteria(fixture.input);
      const { expected } = fixture;

      expect(parsed.status).toBe(expected.status);

      // criteria names + bonus flags
      expect(parsed.criteria.map((c) => c.name)).toEqual(
        expected.criteria.map((c) => c.name)
      );
      expect(parsed.criteria.length).toBe(expected.criteria.length);

      for (let i = 0; i < expected.criteria.length; i++) {
        const got = parsed.criteria[i];
        const want = expected.criteria[i];
        if (typeof want.points === "number") {
          expect(got.points, `${fixture.id} crit ${i} points`).toBe(want.points);
        }
        if (typeof want.weight === "number") {
          expect(got.weight, `${fixture.id} crit ${i} weight`).toBeCloseTo(
            want.weight,
            2
          );
        }
        expect(Boolean(got.isBonus), `${fixture.id} crit ${i} isBonus`).toBe(
          Boolean(want.isBonus)
        );
      }

      // totals
      expect(parsed.totalPoints).toBe(expected.totalPoints);
      if (expected.totalSource) {
        expect(parsed.totalSource).toBe(expected.totalSource);
      }
      if (typeof expected.hasPerformanceLevels === "boolean") {
        expect(parsed.hasPerformanceLevels).toBe(expected.hasPerformanceLevels);
      }
      if (typeof expected.levelMappingAmbiguous === "boolean") {
        expect(parsed.levelMappingAmbiguous).toBe(expected.levelMappingAmbiguous);
      }
      if (expected.noticeKinds) {
        const got = parsed.notices.map((n) => n.kind);
        for (const kind of expected.noticeKinds) {
          expect(got, `${fixture.id} missing notice ${kind}`).toContain(kind);
        }
      }

      // Unparseable inputs must fail gracefully — never partial.
      if (expected.status !== "valid") {
        expect(parsed.criteria).toHaveLength(0);
        expect(parsed.totalSource).toBe("unknown");
      }
    });
  }
});
