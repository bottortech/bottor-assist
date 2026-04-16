/**
 * =============================================================================
 * SAMPLE GRADING LIBRARY (v2) ACCESSOR
 * =============================================================================
 *
 * Loads bottor_assist_sample_library_v2.json and exposes filtered access by
 * subject + grade band. Used by the "Try sample files" flow in Step 1.
 *
 * Structure is intentionally simple so additional samples / subjects /
 * grade bands can be added by editing the JSON only — no code changes.
 * =============================================================================
 */

import raw from "./sample-grading-library-v2.json";

export type SampleSubject = "ELA" | "Math" | "Science" | "Social Studies";
export type SampleGradeBandKey = "MS" | "HS";

export interface SampleRubricCriterion {
  name: string;
  description: string;
  points: Record<string, number>;
  descriptors: Record<string, string>;
}

export interface SampleRubric {
  scale: string[];
  criteria: SampleRubricCriterion[];
}

export interface SampleV2 {
  id: string;
  subject: SampleSubject;
  gradeBand: string; // e.g. "Middle School (Grade 7)"
  assignmentType: string;
  assignmentTitle: string;
  assignmentContext: string;
  assignmentInstructions: string;
  studentName: string;
  submissionDate: string;
  studentSubmission: string;
  rubric: SampleRubric;
  teacherNote?: string;
}

interface RawLibrary {
  samples: SampleV2[];
}

const library = raw as RawLibrary;

const GRADE_BAND_LABELS: Record<SampleGradeBandKey, string> = {
  MS: "Middle School",
  HS: "High School",
};

export const SAMPLE_SUBJECTS: SampleSubject[] = [
  "ELA",
  "Math",
  "Science",
  "Social Studies",
];

export const SAMPLE_GRADE_BANDS: { key: SampleGradeBandKey; label: string }[] = [
  { key: "MS", label: "Middle School" },
  { key: "HS", label: "High School" },
];

function matchesGradeBand(sample: SampleV2, key: SampleGradeBandKey): boolean {
  return sample.gradeBand.startsWith(GRADE_BAND_LABELS[key]);
}

export function findSample(
  subject: SampleSubject,
  gradeBand: SampleGradeBandKey
): SampleV2 | undefined {
  return library.samples.find(
    (s) => s.subject === subject && matchesGradeBand(s, gradeBand)
  );
}

export function getAvailableGradeBands(
  subject: SampleSubject
): SampleGradeBandKey[] {
  return SAMPLE_GRADE_BANDS.filter(({ key }) =>
    library.samples.some(
      (s) => s.subject === subject && matchesGradeBand(s, key)
    )
  ).map((g) => g.key);
}

/**
 * Format the rubric into plain text the existing grading pipeline understands.
 * Includes total points so parseRubricForPoints picks it up cleanly.
 */
export function formatRubricAsText(sample: SampleV2): string {
  const total = sample.rubric.criteria.reduce(
    (sum, c) => sum + (c.points["4"] ?? 0),
    0
  );
  const lines: string[] = [];
  lines.push(`${sample.assignmentTitle} — Rubric`);
  lines.push(`Total Points: ${total}`);
  lines.push("");
  for (const c of sample.rubric.criteria) {
    const pts = c.points["4"] ?? 0;
    lines.push(`${c.name} — ${pts} points`);
    if (c.description) lines.push(`  ${c.description}`);
    for (const level of sample.rubric.scale) {
      const desc = c.descriptors[level];
      const p = c.points[level];
      if (desc != null && p != null) {
        lines.push(`    ${level} (${p} pts): ${desc}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

/**
 * Build the "student work" body in the same shape OCR would produce, including
 * an instructions header so feedback-only mode has full context.
 */
export function formatStudentWork(sample: SampleV2): string {
  return [
    `Assignment: ${sample.assignmentTitle}`,
    `Student: ${sample.studentName}`,
    `Date: ${sample.submissionDate}`,
    "",
    "--- Instructions ---",
    sample.assignmentInstructions,
    "",
    "--- Student Submission ---",
    sample.studentSubmission,
  ].join("\n");
}

export function buildSampleFileName(sample: SampleV2): string {
  const safeStudent = sample.studentName.replace(/\s+/g, "_");
  const safeTitle = sample.assignmentTitle
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return `${safeStudent}_${safeTitle}.pdf`;
}
