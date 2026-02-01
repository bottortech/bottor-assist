/**
 * =============================================================================
 * SESSION DATA TYPES
 * =============================================================================
 * 
 * FIELD NAMING CONVENTION:
 * All fields use snake_case to match database schema exactly.
 * Do NOT use camelCase in form state - convert at the UI boundary only.
 * =============================================================================
 */

/**
 * Input mode determines how the session was created
 * - transcript: Text-based transcript input
 * - audio: Audio recording that was transcribed
 * - grading: Paper grading workflow
 */
export type InputMode = 'transcript' | 'audio' | 'grading';

/**
 * Session status lifecycle:
 * - recording: Audio capture in progress (audio mode only)
 * - processing: AI processing in progress
 * - completed: Ready for viewing
 * - failed: Processing failed, can retry
 */
export type SessionStatus = 'recording' | 'processing' | 'completed' | 'failed';

/**
 * Structured summary output from AI
 * 
 * IMPORTANT: All array fields MUST be validated before mapping.
 * The AI may return strings instead of arrays in edge cases.
 */
export interface SummaryJson {
  lesson_summary: string[];
  student_understanding: {
    strengths: string[];
    challenges: string[];
  };
  attention_flags: string[];
  next_steps: string[];
  // Present when recording was too brief for analysis
  brief_recording?: boolean;
  brief_reason?: string;
}

/**
 * Complete session record as stored in database
 * 
 * DATABASE TABLE: public.sessions
 */
export interface Session {
  id: string;
  user_id: string;
  created_at: string;
  status: SessionStatus;
  
  // Input data
  input_mode?: InputMode;
  audio_path?: string | null;       // Storage path for audio file
  
  // AI-generated content
  transcript_text?: string | null;  // Full transcript from audio
  summary_json?: SummaryJson | null;
  
  // Parent communication
  parent_message_teacher?: string | null; // Warm, detailed version
  parent_message_parent?: string | null;  // SMS-ready version
  
  // Display metadata
  title?: string | null;
  snippet?: string | null;
  duration_seconds?: number | null;
  error_message?: string | null;
}

/**
 * Session list item for /history page
 * Minimal projection for performance
 */
export interface SessionListItem {
  id: string;
  title: string | null;
  snippet: string | null;
  created_at: string;
  duration_seconds: number | null;
  status: SessionStatus;
  input_mode?: InputMode;
}

/**
 * =============================================================================
 * HELPER FUNCTIONS
 * =============================================================================
 */

/**
 * Safely parse summary_json with array validation
 * Use this whenever reading summary_json from database
 */
export function parseSummaryJson(raw: unknown): SummaryJson | null {
  if (!raw) return null;
  
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  
  return {
    lesson_summary: Array.isArray(data.lesson_summary) ? data.lesson_summary : [],
    student_understanding: {
      strengths: Array.isArray(data.student_understanding?.strengths) 
        ? data.student_understanding.strengths : [],
      challenges: Array.isArray(data.student_understanding?.challenges) 
        ? data.student_understanding.challenges : [],
    },
    attention_flags: Array.isArray(data.attention_flags) ? data.attention_flags : [],
    next_steps: Array.isArray(data.next_steps) ? data.next_steps : [],
    brief_recording: data.brief_recording,
    brief_reason: data.brief_reason,
  };
}
