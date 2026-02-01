/**
 * =============================================================================
 * UNIVERSAL RUBRIC TYPES
 * =============================================================================
 * 
 * SOURCE-AGNOSTIC rubric schema that supports:
 * - Manual text/file upload (current)
 * - Google Classroom rubric API (future)
 * - Saved rubrics from database
 * - Auto-generated rubrics
 * 
 * DESIGN PRINCIPLES:
 * - Rubrics normalize to this structure regardless of source
 * - Support for weighted and non-weighted rubrics
 * - Confidence scoring for parsed/inferred rubrics
 * =============================================================================
 */

import type { ConfidenceScore } from './submission';

/**
 * Source of the rubric
 */
export type RubricSource = 
  | 'manual_text'        // Teacher pasted text
  | 'file_upload'        // Extracted from uploaded file
  | 'google_classroom'   // From Classroom API (future)
  | 'saved'              // From saved_rubrics table
  | 'auto_generated';    // AI-generated default

/**
 * A performance level within a criterion
 * e.g., "Excellent (4 points)", "Proficient (3 points)"
 */
export interface RubricLevel {
  label: string;         // e.g., "Proficient"
  points: number;        // Points for this level
  description?: string;  // What this level looks like
}

/**
 * A single grading criterion
 * e.g., "Ideas & Content (25 points max)"
 */
export interface RubricCriterion {
  id: string;
  name: string;          // e.g., "Ideas & Content"
  description?: string;  // What this criterion evaluates
  maxPoints: number;     // Maximum points possible
  weight?: number;       // For weighted rubrics (percentage)
  levels?: RubricLevel[]; // Performance levels (optional)
}

/**
 * Point scale type
 */
export type PointScaleType = 
  | 'total'           // Explicit "Total: X points"
  | 'per-question'    // X points per question
  | 'by-category'     // Sum of category points
  | 'weighted-100'    // Categories sum to 100%
  | 'inferred'        // Inferred from context
  | 'none';           // No points detected

/**
 * Universal Rubric schema
 * Normalized structure for all rubric sources
 */
export interface Rubric {
  id: string;
  name?: string;         // Optional name for saved rubrics
  
  // Source metadata
  source: RubricSource;
  sourceMetadata?: {
    classroomRubricId?: string;  // Google Classroom rubric ID
    savedRubricId?: string;      // Database ID
    originalText?: string;       // Raw text before parsing
  };
  
  // Structure
  totalPoints: number | null;    // Null if not determinable
  pointScaleType: PointScaleType;
  criteria: RubricCriterion[];
  
  // Detection metadata
  parsingConfidence: ConfidenceScore;
  hasPerformanceLevels: boolean; // Has "4=Excellent" style descriptors
  isWeighted: boolean;           // Category weights sum to 100
  
  // Subject detection
  detectedSubject?: string;
  subjectConfidence?: ConfidenceScore;
  
  // Timestamps
  createdAt: string;
  updatedAt: string;
}

/**
 * Answer key structure
 */
export interface AnswerKey {
  id: string;
  source: 'manual_text' | 'file_upload';
  
  // Content
  rawText: string;
  
  // Parsed answers (if applicable)
  answers?: Array<{
    questionNumber: number | string;
    correctAnswer: string;
    pointValue?: number;
  }>;
  
  // Detection
  questionCount?: number;
  parsingConfidence: ConfidenceScore;
  
  createdAt: string;
}

/**
 * Combined grading criteria (rubric + answer key)
 */
export interface GradingCriteria {
  rubric?: Rubric;
  answerKey?: AnswerKey;
  
  // Computed properties
  hasCriteria: boolean;          // Either rubric or answer key present
  canGenerateScore: boolean;     // Has enough info for numeric score
  gradingMode: 'scoring' | 'feedback-only';
  
  // Subject routing
  detectedSubject: string;       // 'Math', 'ELA', 'Science', etc.
  gradingPipeline: 'math' | 'ela'; // Which edge function to use
}

/**
 * Create GradingCriteria from rubric and answer key
 */
export function createGradingCriteria(
  rubric?: Rubric,
  answerKey?: AnswerKey
): GradingCriteria {
  const hasCriteria = !!(rubric || answerKey);
  const canGenerateScore = !!(rubric?.totalPoints || answerKey?.questionCount);
  
  // Determine grading pipeline based on detected subject
  const detectedSubject = rubric?.detectedSubject || 'General';
  const elaSubjects = ['ELA', 'Writing', 'English'];
  const gradingPipeline = elaSubjects.includes(detectedSubject) ? 'ela' : 'math';
  
  return {
    rubric,
    answerKey,
    hasCriteria,
    canGenerateScore,
    gradingMode: hasCriteria ? 'scoring' : 'feedback-only',
    detectedSubject,
    gradingPipeline,
  };
}

/**
 * Parse rubric text to extract structure
 * Returns a normalized Rubric object
 */
export function parseRubricText(
  rawText: string,
  source: RubricSource = 'manual_text'
): Rubric {
  const criteria: RubricCriterion[] = [];
  let totalPoints: number | null = null;
  let pointScaleType: PointScaleType = 'none';
  let hasPerformanceLevels = false;
  let parsingConfidence = 0.5;
  
  if (!rawText?.trim()) {
    return {
      id: crypto.randomUUID(),
      source,
      totalPoints: null,
      pointScaleType: 'none',
      criteria: [],
      parsingConfidence: { value: 0, level: 'low', reason: 'No text provided' },
      hasPerformanceLevels: false,
      isWeighted: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
  
  // Detect performance levels
  const performanceLevelPatterns = [
    /[1-5]\s*[=\-–:]\s*(?:excellent|exceeds|proficient|meets|developing|emerging|beginning)/i,
    /(?:level|score|rating)\s*[1-5]/i,
  ];
  hasPerformanceLevels = performanceLevelPatterns.some(p => p.test(rawText));
  
  // Look for explicit total
  const totalPatterns = [
    /total\s*points?\s*[:=]\s*(\d+)/i,
    /total\s*[:=]\s*(\d+)\s*(?:pts?|points?)/i,
    /(\d+)\s*(?:pts?|points?)\s*total/i,
    /max(?:imum)?\s*(?:score|points?)?\s*[:=]?\s*(\d+)/i,
  ];
  
  for (const pattern of totalPatterns) {
    const match = rawText.match(pattern);
    if (match) {
      const val = parseInt(match[1], 10);
      if (val > 0 && val <= 1000) {
        totalPoints = val;
        pointScaleType = 'total';
        parsingConfidence = 0.9;
        break;
      }
    }
  }
  
  // Parse criteria with point values
  const criteriaPattern = /([A-Za-z][A-Za-z\s\/\-–]+?)(?:[\-–:]|\s*[\(\[])\s*(\d+)\s*(?:pts?|points?)(?:[\)\]])?/g;
  let match;
  while ((match = criteriaPattern.exec(rawText)) !== null) {
    const name = match[1]?.trim();
    const points = parseInt(match[2], 10);
    
    if (name && name.length > 2 && name.length < 60 && points > 0 && points <= 100) {
      const lowerName = name.toLowerCase();
      const isExcluded = ['total', 'maximum', 'max', 'out of'].some(ex => lowerName.startsWith(ex));
      
      if (!isExcluded && !criteria.some(c => c.name.toLowerCase() === lowerName)) {
        criteria.push({
          id: crypto.randomUUID(),
          name,
          maxPoints: points,
        });
      }
    }
  }
  
  // Calculate total from criteria if not explicit
  const sumOfCriteria = criteria.reduce((sum, c) => sum + c.maxPoints, 0);
  const isWeighted = sumOfCriteria === 100 && criteria.length >= 2;
  
  if (!totalPoints && sumOfCriteria > 0) {
    totalPoints = sumOfCriteria;
    pointScaleType = isWeighted ? 'weighted-100' : 'by-category';
    parsingConfidence = criteria.length >= 2 ? 0.8 : 0.6;
  }
  
  return {
    id: crypto.randomUUID(),
    source,
    sourceMetadata: { originalText: rawText },
    totalPoints,
    pointScaleType,
    criteria,
    parsingConfidence: {
      value: parsingConfidence,
      level: parsingConfidence >= 0.8 ? 'high' : parsingConfidence >= 0.5 ? 'medium' : 'low',
      reason: totalPoints ? `Detected ${totalPoints} total points` : 'Could not determine total points',
    },
    hasPerformanceLevels,
    isWeighted,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
