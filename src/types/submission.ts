/**
 * =============================================================================
 * UNIVERSAL SUBMISSION TYPES
 * =============================================================================
 * 
 * SOURCE-AGNOSTIC data structures that support:
 * - Manual file uploads (current)
 * - Google Classroom integration (future)
 * - Other LMS integrations (future)
 * 
 * DESIGN PRINCIPLES:
 * - All submissions normalize to this interface regardless of source
 * - Confidence scoring (0-1) throughout the pipeline
 * - Source metadata preserved for auditing/debugging
 * =============================================================================
 */

/**
 * Source of the submission data
 */
export type SubmissionSource = 
  | 'upload'           // Manual file upload
  | 'google_classroom' // Google Classroom API (future)
  | 'canvas'           // Canvas LMS (future)
  | 'manual_entry';    // Direct text entry

/**
 * Status of a submission in the grading pipeline
 */
export type SubmissionStatus = 
  | 'pending'          // Awaiting grading
  | 'processing'       // Currently being graded
  | 'graded'           // Grading complete
  | 'review_needed'    // Flagged for teacher review
  | 'failed';          // Processing failed

/**
 * Confidence level with numeric value (0-1 scale)
 */
export interface ConfidenceScore {
  value: number;       // 0.0 to 1.0
  level: 'high' | 'medium' | 'low';
  reason?: string;     // Why this confidence level
}

/**
 * Helper to create confidence score from numeric value
 */
export function createConfidenceScore(value: number, reason?: string): ConfidenceScore {
  const clampedValue = Math.max(0, Math.min(1, value));
  return {
    value: clampedValue,
    level: clampedValue >= 0.8 ? 'high' : clampedValue >= 0.5 ? 'medium' : 'low',
    reason,
  };
}

/**
 * A page/file within a submission
 */
export interface SubmissionPage {
  id: string;
  filename: string;
  fileType: 'image' | 'pdf' | 'document';
  pageNumber?: number;           // For multi-page PDFs
  previewUrl?: string;           // For UI display
  extractedText?: string;        // OCR/extracted content
  extractionConfidence?: ConfidenceScore;
}

/**
 * Universal Submission interface
 * Normalized structure for all submission sources
 */
export interface Submission {
  id: string;
  studentId?: string;            // External ID (Classroom, etc.)
  studentName: string;
  studentEmail?: string;         // From Classroom integration
  
  // Source metadata
  source: SubmissionSource;
  sourceMetadata?: {
    classroomId?: string;        // Google Classroom assignment ID
    courseId?: string;           // Google Classroom course ID
    lmsSubmissionId?: string;    // Original LMS submission ID
    uploadedAt?: string;         // When file was uploaded
  };
  
  // Content
  pages: SubmissionPage[];
  combinedText: string;          // All extracted text combined
  
  // Detection metadata
  nameDetection: {
    detectedName: string;
    source: 'document' | 'filename' | 'lms' | 'manual';
    confidence: ConfidenceScore;
    confirmed: boolean;          // Teacher has confirmed
  };
  
  dateDetection?: {
    detectedDate: string;
    confidence: ConfidenceScore;
  };
  
  // Status
  status: SubmissionStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * Grading result attached to a submission
 */
export interface SubmissionGradingResult {
  submissionId: string;
  
  // Score (if criteria provided)
  score?: {
    earned: number;
    possible: number;
    percent: number;
    letterGrade?: string;
  };
  
  // Feedback (always present)
  feedback: {
    strengths: string[];
    areasForImprovement: string[];
    draftFeedback: string;       // Paragraph form
    nextStep?: string;
  };
  
  // Rubric breakdown (if rubric used)
  criterionBreakdown?: Array<{
    criterion: string;
    earned: number;
    possible: number;
    level?: string;
    evidence: string;
  }>;
  
  // Confidence in the grading
  confidence: ConfidenceScore;
  
  // Metadata
  gradedAt: string;
  modelUsed?: string;
  processingTimeMs?: number;
}

/**
 * Batch of submissions to grade together
 */
export interface SubmissionBatch {
  id: string;
  userId: string;
  
  // Assignment context
  assignmentTitle?: string;
  subject?: string;
  gradeLevel?: string;
  
  // Submissions
  submissions: Submission[];
  
  // Grading criteria
  rubricId?: string;
  answerKeyId?: string;
  
  // Status
  totalCount: number;
  gradedCount: number;
  status: 'pending' | 'processing' | 'completed' | 'partial';
  
  createdAt: string;
  completedAt?: string;
}

/**
 * Convert legacy StudentGroup to new Submission format
 */
export function legacyGroupToSubmission(
  group: {
    studentName: string;
    detectedName: string;
    nameSource: 'document' | 'filename' | 'unknown';
    nameConfidence: 'high' | 'low';
    nameConfirmed: boolean;
    files: Array<{ id: string; name: string; previewUrl?: string }>;
    extractedText: string;
  }
): Submission {
  return {
    id: crypto.randomUUID(),
    studentName: group.studentName,
    source: 'upload',
    pages: group.files.map((f, idx) => ({
      id: f.id,
      filename: f.name,
      fileType: f.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'image',
      pageNumber: idx + 1,
      previewUrl: f.previewUrl,
    })),
    combinedText: group.extractedText,
    nameDetection: {
      detectedName: group.detectedName,
      source: group.nameSource === 'unknown' ? 'filename' : group.nameSource,
      confidence: createConfidenceScore(
        group.nameConfidence === 'high' ? 0.9 : 0.4,
        `Detected from ${group.nameSource}`
      ),
      confirmed: group.nameConfirmed,
    },
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
