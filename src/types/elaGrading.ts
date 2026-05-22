/**
 * =============================================================================
 * ELA/Writing Grading Types
 * =============================================================================
 * 
 * Types for the ELA grading pipeline including:
 * - Student packet mapping (grouping images by student)
 * - Rubric schema interpretation
 * - Scoring results
 * - Student feedback generation
 */

export interface PacketMapResult {
  packets: Array<{
    studentName: string;
    images: string[];
    confidence: number;
  }>;
  flaggedForReview: Array<{
    images: string[];
    issue: string;
    possibleNames?: string[];
  }>;
}

export interface RubricLevel {
  label: string;       // e.g., "Proficient"
  points: number;      // exact points for this level
  minPoints: number;   // minimum points threshold
  description?: string;
}

export interface RubricCriterion {
  name: string;         // e.g., "Ideas & Content"
  maxPoints: number;    // e.g., 25
  levels: RubricLevel[];
  weight?: number;      // optional weight for weighted rubrics
}

export interface RubricSchema {
  scale: number;        // e.g., 100 (total possible points)
  criteria: RubricCriterion[];
  source: 'parsed' | 'inferred' | 'default';
  confidence: 'high' | 'medium' | 'low';
}

export interface CriterionScore {
  criterion: string;    // criterion name
  earned: number;       // points earned
  possible: number;     // max possible
  level?: string;       // e.g., "Proficient"
  evidence: string;     // specific evidence from the work
}

export interface ScoringResult {
  studentName: string;
  earned: number;
  possible: number;
  percent: number;
  letterGrade?: string;
  criterionScores: CriterionScore[];
  confidence: 'high' | 'medium' | 'low';
  flags?: string[];     // any issues detected
}

export interface StudentFeedback {
  studentName: string;
  score: string;              // e.g., "68/100 (68%)"
  letterGrade?: string;       // e.g., "D+"
  strengths: string[];        // bullet points
  areasForImprovement: string[];  // bullet points
  nextStep: string;           // single actionable recommendation
  confidence: number;         // 0-100
  criterionBreakdown?: CriterionScore[];
  teacherNotes?: string;      // additional notes for teacher
}

export interface ELAGradingResult {
  mode: 'ela';
  students: StudentFeedback[];
  rubricUsed: RubricSchema | null;
  processingTime: number;     // ms
  warnings?: string[];        // any pipeline warnings
}

// Request types for the edge function
export interface ELAGradeRequest {
  student_work: string;       // OCR text from student images
  student_name?: string;      // detected or provided name
  rubric_text?: string;       // optional rubric text
  grade_level?: string;       // e.g., "5th Grade"
  assignment_type?: string;   // e.g., "Persuasive Essay"
}

// Response type from edge function (matches StudentFeedback structure)
export interface ELAGradeResponse {
  student_name: string;
  score: string;
  letter_grade?: string;
  percent?: number;
  earned?: number;
  possible?: number;
  strengths: string[];
  areas_for_improvement: string[];
  next_step: string;
  confidence: number;
  criterion_breakdown?: Array<{
    criterion: string;
    earned: number;
    possible: number;
    level?: string;
    evidence: string;
  }>;
  teacher_notes?: string;
  rubric_used?: {
    scale: number;
    criteria_count: number;
    source: string;
  };
  consistency_check?: {
    passed: boolean;
    adjustments: {
      criterion: string;
      matched_note: string;
      original_earned: number;
      adjusted_earned: number;
    }[];
  };
}
