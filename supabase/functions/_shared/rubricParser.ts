/**
 * =============================================================================
 * SHARED RUBRIC PARSER — single source of truth
 * =============================================================================
 *
 * Used by both the frontend (via `src/lib/rubricParser.ts` re-export) and
 * the Deno edge functions (`grade-paper`, `grade-ela`). Pure TypeScript,
 * no Deno or browser APIs.
 *
 * Pipeline:
 *   parseRubricCriteria(text)   -> ParsedRubricResult (raw extraction)
 *   normalizeToPoints(parsed)   -> ParsedRubricResult (every criterion in pts)
 *   formatParsedRubricForGrading(parsed) -> string for the model prompt
 *
 * The display layer should consume the raw (un-normalized) result so it can
 * still show original percentages when the teacher provided them. The model
 * always sees points.
 * =============================================================================
 */

export interface ParsedRubricCriterion {
  name: string;
  /** Final points value. After normalizeToPoints() this is always set. */
  points: number | null;
  /** Original weight if the rubric used percentages. Cleared after normalize. */
  weight: number | null;
  description: string;
  levels?: string[];
  /** Extra-credit / bonus criterion. Excluded from totalPoints. */
  isBonus?: boolean;
}

export interface ParsedRubricNotice {
  kind:
    | "bonus_detected"
    | "total_summed"
    | "level_mapping_ambiguous"
    | "weights_normalized"
    | "mixed_units";
  message: string;
}

export interface ParsedRubricResult {
  status: "empty" | "valid" | "invalid";
  criteria: ParsedRubricCriterion[];
  /** Total points excluding bonus criteria. */
  totalPoints: number | null;
  /** How totalPoints was derived. */
  totalSource: "explicit" | "summed" | "weighted-100" | "unknown";
  issues: string[];
  notices: ParsedRubricNotice[];
  suspiciousLabels: string[];
  confidence: "high" | "medium" | "low";
  sourceText: string;
  hasPerformanceLevels: boolean;
  levelMappingAmbiguous: boolean;
  /** Marker so callers can tell if normalizeToPoints() has run. */
  normalized: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const METADATA_LABELS = [
  "grade level",
  "format",
  "subject",
  "length",
  "date",
  "period",
  "class",
  "teacher",
  "student",
  "name",
  "assignment",
  "prompt",
  "instructions",
  "due date",
  "course",
  "standard",
  "objective",
  "materials",
  "total",
  "total points",
  "total score",
  "score",
  "points",
  "points possible",
  "possible points",
  "out of",
  "grade",
  "overall",
];

const RUBRIC_SECTION_MARKERS = [
  "rubric",
  "scoring guide",
  "grading criteria",
  "evaluation criteria",
  "assessment criteria",
];

const NEXT_SECTION_MARKERS = [
  "student work",
  "submission",
  "directions",
  "instructions",
  "prompt",
  "source material",
  "reading passage",
  "answer key",
];

const BONUS_KEYWORDS = /\b(bonus|extra\s*credit)\b/i;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const normalize = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const isMetadataLabel = (label: string) => {
  const n = normalize(label);
  return METADATA_LABELS.some((meta) => n === meta || n.startsWith(`${meta} `));
};

const cleanName = (name: string) =>
  name
    .replace(/^[-*•+\d.)\s]+/, "")
    .replace(/\b(?:criterion|criteria)\b\s*[:\-–]?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();

const parseNum = (raw: string) => {
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : NaN;
};

function isolateRubricText(rawText: string) {
  const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const startIndex = lines.findIndex((line) => {
    const n = normalize(line);
    const looksLikeTableHeader =
      /criterion|criteria/.test(n) &&
      /weight|points|pts|description|measures|levels|score/.test(n);
    return (
      looksLikeTableHeader ||
      RUBRIC_SECTION_MARKERS.some((marker) => n.includes(marker))
    );
  });

  if (startIndex < 0) return rawText;

  const selected: string[] = [];
  for (let i = startIndex; i < lines.length; i++) {
    const n = normalize(lines[i]);
    const isLaterMajorSection =
      i > startIndex + 2 &&
      NEXT_SECTION_MARKERS.some(
        (marker) => n === marker || n.startsWith(`${marker}:`)
      );
    if (isLaterMajorSection) break;
    selected.push(lines[i]);
  }
  return selected.join("\n");
}

function addCriterion(
  criteria: ParsedRubricCriterion[],
  suspiciousLabels: Set<string>,
  candidate: ParsedRubricCriterion
) {
  const name = cleanName(candidate.name);
  if (!name || name.length < 2 || name.length > 90) return;

  if (isMetadataLabel(name)) {
    suspiciousLabels.add(name);
    return;
  }

  const hasPoints = typeof candidate.points === "number" && candidate.points > 0;
  const hasWeight = typeof candidate.weight === "number" && candidate.weight > 0;
  if (!hasPoints && !hasWeight) return;

  const key = normalize(name);
  if (criteria.some((c) => normalize(c.name) === key)) return;

  criteria.push({
    ...candidate,
    name,
    points: hasPoints ? candidate.points : null,
    weight: hasWeight ? candidate.weight : null,
    description:
      candidate.description?.trim() || "Teacher-provided rubric criterion",
  });
}

// ---------------------------------------------------------------------------
// Level detection
// ---------------------------------------------------------------------------

const LEVEL_NAME_PATTERNS = [
  /\b(exceeds|advanced|exemplary|mastery)\b/i,
  /\b(meets|proficient|competent)\b/i,
  /\b(approaching|developing|emerging)\b/i,
  /\b(beginning|novice|below|unsatisfactory)\b/i,
];

function detectLevels(text: string): {
  hasLevels: boolean;
  count: number;
  ambiguous: boolean;
} {
  const found = LEVEL_NAME_PATTERNS.filter((p) => p.test(text)).length;
  const numericLevels = Array.from(text.matchAll(/\b([1-9])\s*[=\-–:]/g))
    .map((m) => parseInt(m[1], 10))
    .filter((n) => n >= 1 && n <= 9);
  const maxNum = numericLevels.length
    ? Math.max(...numericLevels)
    : 0;

  const count = Math.max(found, maxNum);
  const hasLevels = count >= 2;
  // Ambiguous when there are not exactly 3 or 4 standard levels
  const ambiguous = hasLevels && (count > 4 || (count > 0 && count < 3));
  return { hasLevels, count, ambiguous };
}

// ---------------------------------------------------------------------------
// Core parse
// ---------------------------------------------------------------------------

export function parseRubricCriteria(rawText: string): ParsedRubricResult {
  if (!rawText?.trim()) {
    return {
      status: "empty",
      criteria: [],
      totalPoints: null,
      totalSource: "unknown",
      issues: [],
      notices: [],
      suspiciousLabels: [],
      confidence: "low",
      sourceText: "",
      hasPerformanceLevels: false,
      levelMappingAmbiguous: false,
      normalized: false,
    };
  }

  const sourceText = isolateRubricText(rawText);
  const lines = sourceText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const criteria: ParsedRubricCriterion[] = [];
  const suspiciousLabels = new Set<string>();
  const notices: ParsedRubricNotice[] = [];

  // Decimal-aware: \d{1,3}(?:\.\d+)?
  const NUM = String.raw`\d{1,3}(?:\.\d+)?`;
  const patterns: RegExp[] = [
    // "Name: 25 pts — description"  /  "Name (25 pts) — description"
    new RegExp(
      `^(.{2,90}?)\\s*[(:\\-–]\\s*(${NUM})\\s*(pts?|points?)\\)?\\s*[:\\-–]?\\s*(.*)$`,
      "i"
    ),
    // "Name: 25% — description"
    new RegExp(
      `^(.{2,90}?)\\s*[(:\\-–]\\s*(${NUM})\\s*%\\)?\\s*[:\\-–]?\\s*(.*)$`,
      "i"
    ),
    // "25 pts: Name — description"
    new RegExp(
      `^(${NUM})\\s*(pts?|points?)\\s*[:\\-–]\\s*(.{2,90}?)(?:\\s*[:\\-–]\\s*(.*))?$`,
      "i"
    ),
    // Column-style: "Name   25 pts   description"
    new RegExp(
      `^(.{2,90}?)\\s{2,}(${NUM})\\s*(pts?|points?|%)\\s{1,}(.+)$`,
      "i"
    ),
  ];

  let bonusFound = false;
  let hasPointsUnit = false;
  let hasPercentUnit = false;

  // Lines that declare the rubric total — skip so they're not parsed as criteria.
  // Matches "Total: 50 pts", "Total Points: 100", "Rubric — Total: 50 points", etc.
  const TOTAL_LINE = /(?:^|[\s\-—–])total\s*(?:points?)?\s*[:=]\s*\d/i;

  for (const line of lines) {
    const stripped = line
      .replace(/^[-*•+]\s*/, "")
      .replace(/^\d+[.)]\s*/, "")
      .trim();

    if (TOTAL_LINE.test(stripped)) continue;

    const labelOnly = stripped.match(/^([^:]{2,50})\s*:/)?.[1];
    if (labelOnly && isMetadataLabel(labelOnly)) {
      suspiciousLabels.add(labelOnly.trim());
    }

    // Bonus / extra credit lines: handle as bonus criterion
    const isBonusLine = BONUS_KEYWORDS.test(stripped) || /^\+\s*\d/.test(stripped);

    for (const pattern of patterns) {
      const match = stripped.match(pattern);
      if (!match) continue;

      const pointsFirst = /^\d/.test(match[1]);
      const rawName = pointsFirst ? match[3] : match[1];
      const rawValue = pointsFirst ? match[1] : match[2];
      const unit = pointsFirst ? match[2] : match[3];
      const description = pointsFirst ? match[4] || "" : match[4] || "";
      const value = parseNum(rawValue);
      if (!Number.isFinite(value) || value <= 0) break;

      const isPercent = unit === "%" || /%/.test(stripped.split(rawValue)[1] ?? "");

      if (isPercent) hasPercentUnit = true;
      else hasPointsUnit = true;

      addCriterion(criteria, suspiciousLabels, {
        name: rawName,
        points: isPercent ? null : value,
        weight: isPercent ? value : null,
        description,
        isBonus: isBonusLine || undefined,
      });
      if (isBonusLine) bonusFound = true;
      break;
    }
  }

  // Levels detection
  const levels = detectLevels(sourceText);

  // Explicit total detection
  const totalPatterns = [
    new RegExp(`total\\s*points?\\s*[:=]\\s*(${NUM})`, "i"),
    new RegExp(`total\\s*[:=]\\s*(${NUM})\\s*(?:pts?|points?)`, "i"),
    new RegExp(`(${NUM})\\s*(?:pts?|points?)\\s*total`, "i"),
    new RegExp(`out\\s+of\\s+(${NUM})`, "i"),
    new RegExp(`max(?:imum)?\\s*(?:score|points?)?\\s*[:=]?\\s*(${NUM})`, "i"),
  ];
  let explicitTotal: number | null = null;
  for (const p of totalPatterns) {
    const m = sourceText.match(p);
    if (m) {
      const v = parseNum(m[1]);
      if (v > 0 && v <= 1000) {
        explicitTotal = Math.round(v);
        break;
      }
    }
  }

  // Sums (exclude bonus)
  const scoring = criteria.filter((c) => !c.isBonus);
  const pointsSum = scoring.reduce((s, c) => s + (c.points ?? 0), 0);
  const weightsSum = scoring.reduce((s, c) => s + (c.weight ?? 0), 0);

  let totalPoints: number | null = null;
  let totalSource: ParsedRubricResult["totalSource"] = "unknown";

  if (explicitTotal) {
    totalPoints = explicitTotal;
    totalSource = "explicit";
  } else if (pointsSum > 0 && weightsSum === 0) {
    totalPoints = Math.round(pointsSum);
    totalSource = "summed";
    notices.push({
      kind: "total_summed",
      message: `We couldn't determine a total, so we summed the criteria to ${totalPoints} points. Is that correct?`,
    });
  } else if (weightsSum >= 99 && weightsSum <= 101 && pointsSum === 0) {
    totalPoints = 100;
    totalSource = "weighted-100";
  } else if (pointsSum > 0 || weightsSum > 0) {
    // Mixed: prefer point sum if present
    totalPoints = pointsSum > 0 ? Math.round(pointsSum) : 100;
    totalSource = pointsSum > 0 ? "summed" : "weighted-100";
    notices.push({
      kind: "mixed_units",
      message:
        "Your rubric mixes points and percentages — we converted percentages to points using the total.",
    });
  }

  const issues: string[] = [];
  if (suspiciousLabels.size > 0) {
    issues.push(
      `Ignored metadata fields: ${Array.from(suspiciousLabels).join(", ")}.`
    );
  }
  if (criteria.length === 0) {
    issues.push("We couldn't find rubric criteria with point values or weights.");
  }
  if (scoring.length === 1) {
    issues.push("Only one scored criterion was detected; confirm this is intentional.");
  }

  if (bonusFound) {
    const bonusPts = criteria
      .filter((c) => c.isBonus)
      .reduce((s, c) => s + (c.points ?? c.weight ?? 0), 0);
    notices.push({
      kind: "bonus_detected",
      message: `Treated bonus / extra-credit line(s) (~${bonusPts} pts) as extra credit — they will not inflate the main total.`,
    });
  }

  if (levels.ambiguous) {
    notices.push({
      kind: "level_mapping_ambiguous",
      message: `Your rubric uses ${levels.count} performance levels — we mapped them to our 4-level scale. Please review.`,
    });
  }

  if (hasPercentUnit && hasPointsUnit) {
    // already covered by mixed_units notice above
  }

  const status: ParsedRubricResult["status"] =
    criteria.length > 0 ? "valid" : "invalid";
  const confidence: ParsedRubricResult["confidence"] =
    criteria.length >= 3 && totalPoints
      ? "high"
      : criteria.length > 0
      ? "medium"
      : "low";

  return {
    status,
    criteria,
    totalPoints,
    totalSource,
    issues,
    notices,
    suspiciousLabels: Array.from(suspiciousLabels),
    confidence,
    sourceText,
    hasPerformanceLevels: levels.hasLevels,
    levelMappingAmbiguous: levels.ambiguous,
    normalized: false,
  };
}

// ---------------------------------------------------------------------------
// Normalization: every criterion expressed in points
// ---------------------------------------------------------------------------

export function normalizeToPoints(parsed: ParsedRubricResult): ParsedRubricResult {
  if (parsed.normalized || parsed.criteria.length === 0) {
    return { ...parsed, normalized: true };
  }

  const scoring = parsed.criteria.filter((c) => !c.isBonus);
  const bonus = parsed.criteria.filter((c) => c.isBonus);

  let total = parsed.totalPoints;
  const weightsSum = scoring.reduce((s, c) => s + (c.weight ?? 0), 0);
  const pointsSum = scoring.reduce((s, c) => s + (c.points ?? 0), 0);

  if (total == null) {
    if (weightsSum >= 99 && weightsSum <= 101) total = 100;
    else if (pointsSum > 0) total = Math.round(pointsSum);
    else total = 100;
  }

  const normalizedScoring: ParsedRubricCriterion[] = scoring.map((c) => {
    if (c.points && c.points > 0) {
      return { ...c, weight: null };
    }
    if (c.weight && c.weight > 0 && total) {
      const pts = Math.round((c.weight / 100) * total);
      return { ...c, points: pts, weight: null };
    }
    return c;
  });

  const normalizedBonus: ParsedRubricCriterion[] = bonus.map((c) => {
    if (c.points && c.points > 0) return { ...c, weight: null };
    if (c.weight && c.weight > 0 && total) {
      return { ...c, points: Math.round((c.weight / 100) * total), weight: null };
    }
    return c;
  });

  const notices = [...parsed.notices];
  if (weightsSum > 0 && pointsSum === 0) {
    notices.push({
      kind: "weights_normalized",
      message: `Percentages converted to points out of ${total} for grading.`,
    });
  }

  return {
    ...parsed,
    totalPoints: total,
    criteria: [...normalizedScoring, ...normalizedBonus],
    notices,
    normalized: true,
  };
}

// ---------------------------------------------------------------------------
// Serialization for model prompt
// ---------------------------------------------------------------------------

export function formatParsedRubricForGrading(parsed: ParsedRubricResult): string {
  const normalized = normalizeToPoints(parsed);

  const scoring = normalized.criteria.filter((c) => !c.isBonus);
  const bonus = normalized.criteria.filter((c) => c.isBonus);

  const totalLine = normalized.totalPoints
    ? `Total Points: ${normalized.totalPoints}`
    : "";

  const criteriaLines = scoring.map((c) => {
    const pts = c.points ?? 0;
    return `- ${c.name}: ${pts} points${
      c.description ? ` — ${c.description}` : ""
    }`;
  });

  const out = [
    "Teacher-provided rubric criteria (validated extraction)",
    totalLine,
    ...criteriaLines,
  ].filter(Boolean);

  if (bonus.length > 0) {
    out.push("");
    out.push("Bonus opportunities (extra credit, not part of main total):");
    for (const c of bonus) {
      out.push(
        `- ${c.name}: +${c.points ?? 0} points${
          c.description ? ` — ${c.description}` : ""
        }`
      );
    }
  }

  return out.join("\n");
}

export function rubricSignature(parsed: ParsedRubricResult): string {
  return parsed.criteria
    .map(
      (c) =>
        `${normalize(c.name)}:${c.points ?? c.weight ?? ""}${c.isBonus ? ":b" : ""}`
    )
    .join("|");
}
