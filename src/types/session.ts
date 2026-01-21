/**
 * =============================================================================
 * SESSION DATA TYPES
 * =============================================================================
 * 
 * NEXT.JS MIGRATION NOTE:
 * These types define the canonical data structure for sessions.
 * When migrating to Next.js, these types should be moved to:
 * - /types/session.ts (for shared types)
 * - Use with tRPC or API routes for type safety
 * 
 * FIELD NAMING CONVENTION:
 * All fields use snake_case to match database schema exactly.
 * Do NOT use camelCase in form state - convert at the UI boundary only.
 * =============================================================================
 */

/**
 * Input mode determines how the session was created
 * - quick_notes: Manual text entry via Quick Notes form
 * - transcript: Future: text-based transcript input
 * - audio: Audio recording that was transcribed
 */
export type InputMode = 'quick_notes' | 'transcript' | 'audio';

/**
 * Session status lifecycle:
 * - recording: Audio capture in progress (audio mode only)
 * - processing: AI processing in progress
 * - completed: Ready for viewing
 * - failed: Processing failed, can retry
 */
export type SessionStatus = 'recording' | 'processing' | 'completed' | 'failed';

/**
 * Quick Notes form input structure
 * Used for manual entry via /quick-notes route
 */
export interface QuickNotesInput {
  subject: string;
  grade: string;
  topic: string;
  activities: string;      // "What we did today"
  struggles: string;       // "What students struggled with"
  attention_needed: string; // "Names/groups needing attention"
  next_steps: string;      // "Homework/assessment/next steps"
}

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
 * 
 * NEXT.JS MIGRATION NOTE:
 * This maps 1:1 with the Supabase `sessions` table.
 * In Next.js, use Prisma or Drizzle for type-safe queries.
 */
export interface Session {
  id: string;
  user_id: string;
  created_at: string;
  status: SessionStatus;
  
  // Input data
  input_mode?: InputMode;
  notes_json?: QuickNotesInput;     // Structured quick notes input
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

/**
 * Convert QuickNotesInput to the format expected by edge functions
 * 
 * NEXT.JS MIGRATION NOTE:
 * This conversion happens at the API boundary in Next.js.
 * Move to /lib/transforms.ts or keep in API route.
 */
export function formatNotesForAI(notes: QuickNotesInput): Record<string, string> {
  return {
    subject: notes.subject || 'Not provided',
    grade: notes.grade || 'Not provided',
    topic: notes.topic || 'Not provided',
    whatWeDid: notes.activities || 'Not provided',
    struggles: notes.struggles || 'Not provided',
    attentionNeeded: notes.attention_needed || 'Not provided',
    nextSteps: notes.next_steps || 'Not provided',
  };
}
