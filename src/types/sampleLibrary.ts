/**
 * =============================================================================
 * SAMPLE GRADING LIBRARY TYPES
 * =============================================================================
 * 
 * Type definitions for the Bottor Assist Sample Grading Library.
 * Each sample represents a complete grading scenario: assignment, student
 * submission, rubric, and evaluation with criterion-level scores.
 * =============================================================================
 */

export interface RubricLevel {
  "4": string;
  "3": string;
  "2": string;
  "1": string;
}

export interface RubricCriterion {
  name: string;
  weight: number;
  rationale: string;
  levels: RubricLevel;
}

export interface SampleRubric {
  scoringNote: string;
  criteria: RubricCriterion[];
}

export interface CriterionScore {
  criterion: string;
  level: number;
  weightedPointsEarned: number;
  weightedPointsPossible: number;
  scoringNote: string;
}

export interface SampleEvaluation {
  criterionScores: CriterionScore[];
  finalScore: number;
  letterGrade: string;
  gradingRationale: string;
}

export interface GradingSample {
  id: string;
  studentName: string;
  subject: string;
  gradeBand: string;
  assignmentType: string;
  assignmentTitle: string;
  assignmentContext: string;
  assignmentInstructions: string;
  submissionDate: string;
  studentSubmission: string;
  rubric: SampleRubric;
  evaluation: SampleEvaluation;
}

export interface SampleLibraryMeta {
  version: string;
  title: string;
  description: string;
  totalSamples: number;
  gradeBands: string[];
  subjects: string[];
}

export interface SampleGradingLibrary {
  meta: SampleLibraryMeta;
  samples: GradingSample[];
}
