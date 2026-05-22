/**
 * Rubric parser fixtures.
 *
 * Each fixture pairs a real-world-style rubric input with an `expected`
 * snapshot of the parser output. Snapshots intentionally pin only the
 * stable fields (status, criteria names/points/bonus flags, totalPoints,
 * totalSource, notice kinds) — not free-text messages.
 */

export interface RubricFixture {
  id: string;
  description: string;
  input: string;
  expected: {
    status: "valid" | "invalid" | "empty";
    criteria: Array<{
      name: string;
      points?: number | null;
      weight?: number | null;
      isBonus?: boolean;
    }>;
    totalPoints: number | null;
    totalSource?: "explicit" | "summed" | "weighted-100" | "unknown";
    hasPerformanceLevels?: boolean;
    levelMappingAmbiguous?: boolean;
    noticeKinds?: string[];
  };
}

export const fixtures: RubricFixture[] = [
  // 1. Plain text — percentage weights
  {
    id: "plain-percent",
    description: "Plain text with weights as percentages",
    input: `Rubric
- Thesis — 25%
- Evidence — 30%
- Analysis — 30%
- Conventions — 15%`,
    expected: {
      status: "valid",
      criteria: [
        { name: "Thesis", weight: 25 },
        { name: "Evidence", weight: 30 },
        { name: "Analysis", weight: 30 },
        { name: "Conventions", weight: 15 },
      ],
      totalPoints: 100,
      totalSource: "weighted-100",
    },
  },

  // 2. Plain text — points
  {
    id: "plain-points",
    description: "Plain text with weights as points",
    input: `Rubric
- Thesis (25 points)
- Evidence (30 points)
- Analysis (30 points)
- Conventions (15 points)`,
    expected: {
      status: "valid",
      criteria: [
        { name: "Thesis", points: 25 },
        { name: "Evidence", points: 30 },
        { name: "Analysis", points: 30 },
        { name: "Conventions", points: 15 },
      ],
      totalPoints: 100,
      totalSource: "summed",
    },
  },

  // 3. Numbered list
  {
    id: "numbered-list",
    description: "Numbered list with points",
    input: `1. Thesis (25 points)
2. Evidence (30 points)
3. Analysis (30 points)
4. Conventions (15 points)`,
    expected: {
      status: "valid",
      criteria: [
        { name: "Thesis", points: 25 },
        { name: "Evidence", points: 30 },
        { name: "Analysis", points: 30 },
        { name: "Conventions", points: 15 },
      ],
      totalPoints: 100,
    },
  },

  // 4. Table format (column-style with whitespace)
  {
    id: "table-columns",
    description: "Table format extracted from a PDF (column-style whitespace)",
    input: `Criterion          Points    Description
Thesis             25 pts    Clear central claim
Evidence           30 pts    Two relevant quotes
Analysis           30 pts    Explanation of evidence
Conventions        15 pts    Grammar and spelling`,
    expected: {
      status: "valid",
      criteria: [
        { name: "Thesis", points: 25 },
        { name: "Evidence", points: 30 },
        { name: "Analysis", points: 30 },
        { name: "Conventions", points: 15 },
      ],
      totalPoints: 100,
    },
  },

  // 5. Standard 4-level performance rubric
  {
    id: "levels-standard-4",
    description: "Performance levels: Exceeds/Meets/Approaches/Below",
    input: `Rubric — 4 = Exceeds, 3 = Meets, 2 = Approaches, 1 = Below
- Ideas: 25 pts
- Organization: 25 pts
- Voice: 25 pts
- Conventions: 25 pts`,
    expected: {
      status: "valid",
      criteria: [
        { name: "Ideas", points: 25 },
        { name: "Organization", points: 25 },
        { name: "Voice", points: 25 },
        { name: "Conventions", points: 25 },
      ],
      totalPoints: 100,
      hasPerformanceLevels: true,
      levelMappingAmbiguous: false,
    },
  },

  // 6. Non-standard performance levels (Mastery/Proficient/Developing)
  {
    id: "levels-nonstandard-3",
    description: "Performance levels: Mastery/Proficient/Developing",
    input: `Rubric — Levels: Mastery, Proficient, Developing
- Ideas: 30 pts
- Voice: 35 pts
- Conventions: 35 pts`,
    expected: {
      status: "valid",
      criteria: [
        { name: "Ideas", points: 30 },
        { name: "Voice", points: 35 },
        { name: "Conventions", points: 35 },
      ],
      totalPoints: 100,
      hasPerformanceLevels: true,
    },
  },

  // 7. 5-level performance rubric
  {
    id: "levels-5",
    description: "5-level performance rubric",
    input: `Rubric — Levels: 5 = Mastery, 4 = Exceeds, 3 = Meets, 2 = Approaching, 1 = Beginning
- Ideas: 25 pts
- Voice: 25 pts
- Conventions: 25 pts
- Organization: 25 pts`,
    expected: {
      status: "valid",
      criteria: [
        { name: "Ideas", points: 25 },
        { name: "Voice", points: 25 },
        { name: "Conventions", points: 25 },
        { name: "Organization", points: 25 },
      ],
      totalPoints: 100,
      hasPerformanceLevels: true,
      levelMappingAmbiguous: true,
      noticeKinds: ["level_mapping_ambiguous"],
    },
  },

  // 8. Mixed points and percentages
  {
    id: "mixed-units",
    description: "Mixed format: points and percentages on different criteria",
    input: `Rubric
Total Points: 100
- Thesis: 25 pts
- Evidence: 30%
- Analysis: 30 pts
- Conventions: 15%`,
    expected: {
      status: "valid",
      criteria: [
        { name: "Thesis", points: 25 },
        { name: "Evidence", weight: 30 },
        { name: "Analysis", points: 30 },
        { name: "Conventions", weight: 15 },
      ],
      totalPoints: 100,
      totalSource: "explicit",
      noticeKinds: ["mixed_units"],
    },
  },

  // 9. Metadata mixed in
  {
    id: "metadata-mixed",
    description: "Rubric with metadata lines (Grade Level / Format / Total Points)",
    input: `Assignment: Persuasive Essay
Grade Level: 9
Format: Essay
Total Points: 100
Rubric
- Thesis: 25 pts
- Evidence: 30 pts
- Analysis: 30 pts
- Conventions: 15 pts`,
    expected: {
      status: "valid",
      criteria: [
        { name: "Thesis", points: 25 },
        { name: "Evidence", points: 30 },
        { name: "Analysis", points: 30 },
        { name: "Conventions", points: 15 },
      ],
      totalPoints: 100,
      totalSource: "explicit",
    },
  },

  // 10. Embedded in larger document
  {
    id: "embedded-doc",
    description: "Rubric embedded in a document with prompt and passage",
    input: `Directions: Read the passage below and write a 500-word response.

Passage:
The quick brown fox jumps over the lazy dog. Lorem ipsum dolor sit amet.

Prompt: How does the author develop the theme of perseverance?

Rubric
Total Points: 100
- Thesis: 25 pts
- Evidence: 30 pts
- Analysis: 30 pts
- Conventions: 15 pts

Student Work:
[student response goes here]`,
    expected: {
      status: "valid",
      criteria: [
        { name: "Thesis", points: 25 },
        { name: "Evidence", points: 30 },
        { name: "Analysis", points: 30 },
        { name: "Conventions", points: 15 },
      ],
      totalPoints: 100,
      totalSource: "explicit",
    },
  },

  // 11a. Non-100 total: 50
  {
    id: "total-50",
    description: "Rubric with total of 50 points",
    input: `Rubric — Total: 50 points
- Accuracy: 25 pts
- Reasoning: 15 pts
- Presentation: 10 pts`,
    expected: {
      status: "valid",
      criteria: [
        { name: "Accuracy", points: 25 },
        { name: "Reasoning", points: 15 },
        { name: "Presentation", points: 10 },
      ],
      totalPoints: 50,
      totalSource: "explicit",
    },
  },

  // 11b. Non-100 total: 20
  {
    id: "total-20",
    description: "Rubric with total of 20 points",
    input: `Total Points: 20
- Setup: 5 pts
- Work shown: 10 pts
- Answer: 5 pts`,
    expected: {
      status: "valid",
      criteria: [
        { name: "Setup", points: 5 },
        { name: "Work shown", points: 10 },
        { name: "Answer", points: 5 },
      ],
      totalPoints: 20,
      totalSource: "explicit",
    },
  },

  // 11c. Non-100 total: 75
  {
    id: "total-75",
    description: "Rubric with total of 75 points",
    input: `Rubric (Total: 75 pts)
- Content: 40 pts
- Style: 20 pts
- Mechanics: 15 pts`,
    expected: {
      status: "valid",
      criteria: [
        { name: "Content", points: 40 },
        { name: "Style", points: 20 },
        { name: "Mechanics", points: 15 },
      ],
      totalPoints: 75,
      totalSource: "explicit",
    },
  },

  // 12. Decimal weights
  {
    id: "decimal-weights",
    description: "Rubric with decimal weights (12.5%, 22.5%)",
    input: `Rubric
- Ideas: 12.5%
- Voice: 22.5%
- Content: 65%`,
    expected: {
      status: "valid",
      criteria: [
        { name: "Ideas", weight: 12.5 },
        { name: "Voice", weight: 22.5 },
        { name: "Content", weight: 65 },
      ],
      totalPoints: 100,
      totalSource: "weighted-100",
    },
  },

  // 13. Bonus / extra credit
  {
    id: "bonus-line",
    description: "Rubric with bonus / extra-credit line",
    input: `Rubric
- Content: 80 pts
- Style: 20 pts
- Bonus: 10 pts — Creative use of imagery`,
    expected: {
      status: "valid",
      criteria: [
        { name: "Content", points: 80 },
        { name: "Style", points: 20 },
        { name: "Bonus", points: 10, isBonus: true },
      ],
      totalPoints: 100,
      noticeKinds: ["bonus_detected"],
    },
  },

  // 14a. 2 criteria
  {
    id: "two-criteria",
    description: "Rubric with only 2 criteria",
    input: `- Ideas: 50 pts
- Style: 50 pts`,
    expected: {
      status: "valid",
      criteria: [
        { name: "Ideas", points: 50 },
        { name: "Style", points: 50 },
      ],
      totalPoints: 100,
    },
  },

  // 14b. 8 criteria
  {
    id: "eight-criteria",
    description: "Rubric with 8 criteria",
    input: Array.from({ length: 8 }, (_, i) => `- Criterion${i + 1} item: 12 pts`).join("\n"),
    expected: {
      status: "valid",
      criteria: Array.from({ length: 8 }, (_, i) => ({
        name: `Criterion${i + 1} item`,
        points: 12,
      })),
      totalPoints: 96,
      totalSource: "summed",
    },
  },

  // 15a. Unparseable — random prose
  {
    id: "unparseable-prose",
    description: "Genuinely unparseable: random prose",
    input: `The student should demonstrate clear understanding of the material and write thoughtfully about the themes.`,
    expected: {
      status: "invalid",
      criteria: [],
      totalPoints: null,
      totalSource: "unknown",
    },
  },

  // 15b. Empty
  {
    id: "unparseable-empty",
    description: "Empty input",
    input: "",
    expected: {
      status: "empty",
      criteria: [],
      totalPoints: null,
      totalSource: "unknown",
    },
  },

  // 15c. Malformed table
  {
    id: "unparseable-malformed",
    description: "Malformed table with no recognizable points",
    input: `Criterion | Description
Thesis | something
Evidence | something else
Analysis | more stuff`,
    expected: {
      status: "invalid",
      criteria: [],
      totalPoints: null,
      totalSource: "unknown",
    },
  },
];
