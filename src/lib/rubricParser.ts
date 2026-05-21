export interface ParsedRubricCriterion {
  name: string;
  points: number | null;
  weight: number | null;
  description: string;
  levels?: string[];
}

export interface ParsedRubricResult {
  status: "empty" | "valid" | "invalid";
  criteria: ParsedRubricCriterion[];
  totalPoints: number | null;
  issues: string[];
  suspiciousLabels: string[];
  confidence: "high" | "medium" | "low";
  sourceText: string;
}

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

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const isMetadataLabel = (label: string) => {
  const n = normalize(label);
  return METADATA_LABELS.some((meta) => n === meta || n.startsWith(`${meta} `));
};

const cleanName = (name: string) =>
  name
    .replace(/^[-*•\d.)\s]+/, "")
    .replace(/\b(?:criterion|criteria)\b\s*[:\-–]?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();

function isolateRubricText(rawText: string) {
  const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const startIndex = lines.findIndex((line) => {
    const n = normalize(line);
    const looksLikeTableHeader = /criterion|criteria/.test(n) && /weight|points|pts|description|measures|levels|score/.test(n);
    return looksLikeTableHeader || RUBRIC_SECTION_MARKERS.some((marker) => n.includes(marker));
  });

  if (startIndex < 0) return rawText;

  const selected: string[] = [];
  for (let i = startIndex; i < lines.length; i++) {
    const n = normalize(lines[i]);
    const isLaterMajorSection =
      i > startIndex + 2 &&
      NEXT_SECTION_MARKERS.some((marker) => n === marker || n.startsWith(`${marker}:`));
    if (isLaterMajorSection) break;
    selected.push(lines[i]);
  }
  return selected.join("\n");
}

function addCriterion(
  criteria: ParsedRubricCriterion[],
  suspiciousLabels: Set<string>,
  candidate: ParsedRubricCriterion,
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
  if (criteria.some((criterion) => normalize(criterion.name) === key)) return;

  criteria.push({
    ...candidate,
    name,
    points: hasPoints ? candidate.points : null,
    weight: hasWeight ? candidate.weight : null,
    description: candidate.description?.trim() || "Teacher-provided rubric criterion",
  });
}

export function parseRubricCriteria(rawText: string): ParsedRubricResult {
  if (!rawText?.trim()) {
    return {
      status: "empty",
      criteria: [],
      totalPoints: null,
      issues: [],
      suspiciousLabels: [],
      confidence: "low",
      sourceText: "",
    };
  }

  const sourceText = isolateRubricText(rawText);
  const lines = sourceText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const criteria: ParsedRubricCriterion[] = [];
  const suspiciousLabels = new Set<string>();

  for (const line of lines) {
    const stripped = line.replace(/^[-*•]\s*/, "").replace(/^\d+[.)]\s*/, "").trim();
    const labelOnly = stripped.match(/^([^:]{2,50})\s*:/)?.[1];
    if (labelOnly && isMetadataLabel(labelOnly)) suspiciousLabels.add(labelOnly.trim());

    const patterns: RegExp[] = [
      /^(.{2,90}?)\s*[(:\-–]\s*(\d{1,3})\s*(pts?|points?)\)?\s*[:\-–]?\s*(.*)$/i,
      /^(.{2,90}?)\s*[(:\-–]\s*(\d{1,3})\s*%\)?\s*[:\-–]?\s*(.*)$/i,
      /^(\d{1,3})\s*(pts?|points?)\s*[:\-–]\s*(.{2,90}?)(?:\s*[:\-–]\s*(.*))?$/i,
      /^(.{2,90}?)\s{2,}(\d{1,3})\s*(pts?|points?|%)\s{1,}(.+)$/i,
    ];

    for (const pattern of patterns) {
      const match = stripped.match(pattern);
      if (!match) continue;

      const pointsFirst = /^\d/.test(match[1]);
      const rawName = pointsFirst ? match[3] : match[1];
      const rawValue = pointsFirst ? match[1] : match[2];
      const unit = pointsFirst ? match[2] : match[3];
      const description = pointsFirst ? match[4] || "" : match[4] || "";
      const value = parseInt(rawValue, 10);
      const isWeight = unit === "%" || stripped.includes(`${value}%`);

      addCriterion(criteria, suspiciousLabels, {
        name: rawName,
        points: isWeight ? null : value,
        weight: isWeight ? value : null,
        description,
      });
      break;
    }

    const levelsMatch = stripped.match(
      /^(.{2,80}?)\s*[:\-–]\s*(?:exceeds|excellent|advanced|meets|proficient|approaches|developing|below|beginning).*(\d)\s*(?:pts?|points?)?/i,
    );
    if (levelsMatch) {
      const levelNumbers = Array.from(stripped.matchAll(/\b([1-5])\b/g)).map((m) => parseInt(m[1], 10));
      const maxLevel = Math.max(...levelNumbers, parseInt(levelsMatch[2], 10));
      addCriterion(criteria, suspiciousLabels, {
        name: levelsMatch[1],
        points: maxLevel,
        weight: null,
        description: stripped.slice(levelsMatch[1].length).replace(/^\s*[:\-–]\s*/, ""),
        levels: ["Exceeds", "Meets", "Approaches", "Below"],
      });
    }
  }

  const totalPatterns = [
    /total\s*points?\s*[:=]\s*(\d+)/i,
    /total\s*[:=]\s*(\d+)\s*(?:pts?|points?)/i,
    /(\d+)\s*(?:pts?|points?)\s*total/i,
    /out\s+of\s+(\d+)/i,
  ];
  const explicitTotal = totalPatterns
    .map((pattern) => sourceText.match(pattern)?.[1])
    .filter(Boolean)
    .map((value) => parseInt(value as string, 10))
    .find((value) => value > 0 && value <= 1000) ?? null;

  const pointsSum = criteria.reduce((sum, criterion) => sum + (criterion.points ?? 0), 0);
  const weightsSum = criteria.reduce((sum, criterion) => sum + (criterion.weight ?? 0), 0);
  const totalPoints = explicitTotal ?? (pointsSum > 0 ? pointsSum : weightsSum === 100 ? 100 : null);

  const issues: string[] = [];
  if (suspiciousLabels.size > 0) {
    issues.push(`Ignored metadata fields: ${Array.from(suspiciousLabels).join(", ")}.`);
  }
  if (criteria.length === 0) {
    issues.push("We couldn't find rubric criteria with point values or weights.");
  }
  if (criteria.length === 1) {
    issues.push("Only one scored criterion was detected; confirm this is intentional.");
  }

  const status = criteria.length > 0 ? "valid" : "invalid";
  const confidence = criteria.length >= 3 && (pointsSum > 0 || weightsSum === 100 || explicitTotal) ? "high" : criteria.length > 0 ? "medium" : "low";

  return {
    status,
    criteria,
    totalPoints,
    issues,
    suspiciousLabels: Array.from(suspiciousLabels),
    confidence,
    sourceText,
  };
}

export function formatParsedRubricForGrading(parsed: ParsedRubricResult): string {
  const totalLine = parsed.totalPoints ? `Total Points: ${parsed.totalPoints}` : "";
  const criteriaLines = parsed.criteria.map((criterion) => {
    const value = criterion.points ? `${criterion.points} points` : `${criterion.weight}%`;
    return `- ${criterion.name}: ${value}${criterion.description ? ` — ${criterion.description}` : ""}`;
  });
  return ["Teacher-provided rubric criteria (validated extraction)", totalLine, ...criteriaLines]
    .filter(Boolean)
    .join("\n");
}

export function rubricSignature(parsed: ParsedRubricResult): string {
  return parsed.criteria
    .map((criterion) => `${normalize(criterion.name)}:${criterion.points ?? criterion.weight ?? ""}`)
    .join("|");
}