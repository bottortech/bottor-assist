import { describe, it, expect } from "vitest";
import {
  parseRubricCriteria,
  normalizeToPoints,
  formatParsedRubricForGrading,
} from "@/lib/rubricParser";

describe("shared rubricParser", () => {
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

  it("handles a 50-point rubric end-to-end", () => {
    const text = `Rubric — Total: 50 points
- Accuracy: 25 pts
- Reasoning: 15 pts
- Presentation: 10 pts`;
    const parsed = parseRubricCriteria(text);
    expect(parsed.totalPoints).toBe(50);
    expect(parsed.criteria).toHaveLength(3);
    const formatted = formatParsedRubricForGrading(parsed);
    expect(formatted).toContain("Total Points: 50");
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

  it("supports decimal weights (12.5% / 22.5%)", () => {
    const text = `Rubric
- Ideas: 12.5%
- Voice: 22.5%
- Content: 65%`;
    const parsed = parseRubricCriteria(text);
    expect(parsed.criteria).toHaveLength(3);
    expect(parsed.criteria[0].weight).toBeCloseTo(12.5);
    expect(parsed.criteria[1].weight).toBeCloseTo(22.5);
  });

  it("detects bonus / extra-credit lines and excludes them from total", () => {
    const text = `Rubric
- Content: 80 pts
- Style: 20 pts
- Bonus: 10 pts — Creative use of imagery`;
    const parsed = parseRubricCriteria(text);
    const scoring = parsed.criteria.filter((c) => !c.isBonus);
    const bonus = parsed.criteria.filter((c) => c.isBonus);
    expect(scoring).toHaveLength(2);
    expect(bonus).toHaveLength(1);
    expect(parsed.totalPoints).toBe(100); // does not include bonus
    expect(parsed.notices.some((n) => n.kind === "bonus_detected")).toBe(true);
    const formatted = formatParsedRubricForGrading(parsed);
    expect(formatted).toContain("Bonus opportunities");
  });

  it("flags ambiguous mapping for 5-level rubrics", () => {
    const text = `Rubric — Levels: 5 = Mastery, 4 = Exceeds, 3 = Meets, 2 = Approaching, 1 = Beginning
- Ideas: 25 pts
- Voice: 25 pts
- Conventions: 25 pts
- Organization: 25 pts`;
    const parsed = parseRubricCriteria(text);
    expect(parsed.hasPerformanceLevels).toBe(true);
    expect(parsed.levelMappingAmbiguous).toBe(true);
    expect(parsed.notices.some((n) => n.kind === "level_mapping_ambiguous")).toBe(true);
  });

  it("supports 2-criterion and ~10-criterion rubrics", () => {
    const two = parseRubricCriteria(`- Ideas: 50 pts\n- Style: 50 pts`);
    expect(two.criteria).toHaveLength(2);
    expect(two.totalPoints).toBe(100);

    const ten = parseRubricCriteria(
      Array.from({ length: 10 }, (_, i) => `- Criterion${i + 1} item: 10 pts`).join("\n"),
    );
    expect(ten.criteria).toHaveLength(10);
    expect(ten.totalPoints).toBe(100);
  });
});
