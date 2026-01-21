/**
 * =============================================================================
 * SESSION SERVICE
 * =============================================================================
 * 
 * NEXT.JS MIGRATION NOTE:
 * This service layer abstracts all Supabase operations for sessions.
 * When migrating to Next.js:
 * - Convert to server actions or API routes
 * - Replace supabase client with Prisma/Drizzle
 * - Keep the same function signatures for compatibility
 * 
 * DATA FLOW:
 * 1. UI calls service function
 * 2. Service interacts with Supabase
 * 3. Service returns typed data
 * 4. UI renders from returned data only
 * =============================================================================
 */

import { supabase } from '@/integrations/supabase/client';
import type { 
  SessionListItem,
  SessionStatus,
  QuickNotesInput,
  SummaryJson,
  parseSummaryJson 
} from '@/types/session';

/**
 * =============================================================================
 * SESSION CREATION
 * =============================================================================
 */

/**
 * [MIGRATION POINT: Session Creation]
 * Creates a new session for audio recording mode.
 * Called from: /src/pages/Index.tsx when user clicks "Start Listening"
 */
export async function createRecordingSession(userId: string): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from('sessions')
    .insert({
      user_id: userId,
      status: 'recording' as SessionStatus,
      // NOTE: input_mode field needs migration to add to database
      // input_mode: 'audio' as InputMode,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[Session Service] Failed to create recording session:', error);
    return null;
  }

  return data;
}

/**
 * [MIGRATION POINT: Quick Notes Session]
 * Creates or updates a session from Quick Notes input.
 * Called from: /src/pages/QuickNotes.tsx handleSave()
 */
export async function saveQuickNotesSession(
  userId: string,
  notes: QuickNotesInput,
  summary: string | null,
  parentMessageTeacher: string | null,
  parentMessageParent: string | null,
  existingSessionId?: string | null
): Promise<{ id: string } | null> {
  // Build summary_json structure matching SummaryJson type
  const summaryJson: Partial<SummaryJson> = {
    lesson_summary: summary ? [summary] : [],
    student_understanding: {
      strengths: notes.activities ? [notes.activities] : [],
      challenges: notes.struggles ? [notes.struggles] : [],
    },
    attention_flags: notes.attention_needed 
      ? notes.attention_needed.split(',').map(s => s.trim()).filter(Boolean)
      : [],
    next_steps: notes.next_steps ? [notes.next_steps] : [],
  };

  const sessionData = {
    user_id: userId,
    status: 'completed' as SessionStatus,
    title: notes.topic || `${notes.subject} - ${notes.grade}` || 'Quick Notes Session',
    snippet: notes.activities?.slice(0, 100) || summary?.slice(0, 100) || 'Quick notes session',
    summary_json: summaryJson,
    teacher_notes: JSON.stringify(notes), // Legacy field for backward compatibility
    parent_message_draft: parentMessageTeacher, // Legacy field
    // NOTE: New fields need migration:
    // notes_json: notes,
    // parent_message_teacher: parentMessageTeacher,
    // parent_message_parent: parentMessageParent,
    // input_mode: 'quick_notes' as InputMode,
  };

  if (existingSessionId) {
    const { error } = await supabase
      .from('sessions')
      .update(sessionData)
      .eq('id', existingSessionId);
    
    if (error) {
      console.error('[Session Service] Failed to update session:', error);
      return null;
    }
    return { id: existingSessionId };
  }

  const { data, error } = await supabase
    .from('sessions')
    .insert(sessionData)
    .select('id')
    .single();

  if (error) {
    console.error('[Session Service] Failed to create quick notes session:', error);
    return null;
  }

  return data;
}

/**
 * =============================================================================
 * SESSION RETRIEVAL
 * =============================================================================
 */

/**
 * [MIGRATION POINT: Session List]
 * Fetches session list for /history page.
 * Called from: /src/pages/History.tsx (was Summaries.tsx)
 */
export async function getSessionList(userId: string): Promise<SessionListItem[]> {
  const { data, error } = await supabase
    .from('sessions')
    .select('id, title, snippet, created_at, duration_seconds, status')
    .eq('user_id', userId)
    .in('status', ['completed', 'recording', 'processing'])
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[Session Service] Failed to fetch sessions:', error);
    return [];
  }

  return (data || []).map(row => ({
    ...row,
    status: row.status as SessionStatus,
  }));
}

/**
 * [MIGRATION POINT: Session Detail]
 * Fetches full session for /session/:id page.
 * Called from: /src/pages/Session.tsx (was Summary.tsx)
 * 
 * Returns raw database row - caller should use parseSummaryJson for summary_json
 */
export async function getSession(sessionId: string) {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', sessionId)
    .single();

  if (error) {
    console.error('[Session Service] Failed to fetch session:', error);
    return null;
  }

  return {
    ...data,
    status: data.status as SessionStatus,
    // Rename legacy fields to new standard
    transcript_text: data.transcript,
  };
}

/**
 * =============================================================================
 * SESSION UPDATES
 * =============================================================================
 */

/**
 * [MIGRATION POINT: Teacher Notes Update]
 * Updates teacher notes on a session.
 * Called from: /src/pages/Session.tsx handleSave()
 */
export async function updateTeacherNotes(
  sessionId: string, 
  notes: string
): Promise<boolean> {
  const { error } = await supabase
    .from('sessions')
    .update({ teacher_notes: notes })
    .eq('id', sessionId);

  if (error) {
    console.error('[Session Service] Failed to update notes:', error);
    return false;
  }

  return true;
}

/**
 * [MIGRATION POINT: Parent Message Update]
 * Saves parent message to session.
 * Called from: /src/pages/Session.tsx handleSaveMessage()
 */
export async function updateParentMessage(
  sessionId: string, 
  message: string
): Promise<boolean> {
  const { error } = await supabase
    .from('sessions')
    .update({ parent_message_draft: message })
    .eq('id', sessionId);

  if (error) {
    console.error('[Session Service] Failed to update parent message:', error);
    return false;
  }

  return true;
}

/**
 * [MIGRATION POINT: Session Status Update]
 * Updates session status (for retry flow).
 * Called from: /src/pages/Processing.tsx handleRetry()
 */
export async function updateSessionStatus(
  sessionId: string, 
  status: SessionStatus
): Promise<boolean> {
  const { error } = await supabase
    .from('sessions')
    .update({ status })
    .eq('id', sessionId);

  if (error) {
    console.error('[Session Service] Failed to update status:', error);
    return false;
  }

  return true;
}

/**
 * =============================================================================
 * AI FUNCTION INVOCATIONS
 * =============================================================================
 */

/**
 * [MIGRATION POINT: AI Summary Generation]
 * Invokes edge function to generate summary from quick notes.
 * 
 * NEXT.JS MIGRATION:
 * - Replace with server action or API route
 * - Call Lovable AI gateway directly from Next.js API route
 */
export async function generateQuickNotesSummary(
  notes: QuickNotesInput
): Promise<{ summary: string } | null> {
  // Convert to edge function expected format (legacy camelCase)
  const legacyFormat = {
    subject: notes.subject,
    grade: notes.grade,
    topic: notes.topic,
    whatWeDid: notes.activities,
    struggles: notes.struggles,
    attentionNeeded: notes.attention_needed,
    nextSteps: notes.next_steps,
  };

  const { data, error } = await supabase.functions.invoke('generate-quick-notes-summary', {
    body: { notes: legacyFormat },
  });

  if (error) {
    console.error('[Session Service] Summary generation failed:', error);
    return null;
  }

  return { summary: data.summary };
}

/**
 * [MIGRATION POINT: Parent Message Generation]
 * Invokes edge function to generate parent messages.
 * 
 * NEXT.JS MIGRATION:
 * - Replace with server action or API route
 * - Call Lovable AI gateway directly from Next.js API route
 */
export async function generateParentMessages(
  notes: QuickNotesInput,
  summary: string
): Promise<{ warmMessage: string; smsMessage: string } | null> {
  // Convert to edge function expected format (legacy camelCase)
  const legacyFormat = {
    subject: notes.subject,
    grade: notes.grade,
    topic: notes.topic,
    whatWeDid: notes.activities,
    struggles: notes.struggles,
    attentionNeeded: notes.attention_needed,
    nextSteps: notes.next_steps,
  };

  const { data, error } = await supabase.functions.invoke('generate-parent-messages', {
    body: { notes: legacyFormat, summary },
  });

  if (error) {
    console.error('[Session Service] Parent message generation failed:', error);
    return null;
  }

  return {
    warmMessage: data.warmMessage,
    smsMessage: data.smsMessage,
  };
}

/**
 * [MIGRATION POINT: Single Parent Message (Audio Flow)]
 * Invokes edge function for audio-based sessions.
 */
export async function generateParentMessageForSession(
  sessionId: string
): Promise<{ message: string } | null> {
  const { data, error } = await supabase.functions.invoke('generate-parent-message', {
    body: { sessionId },
  });

  if (error) {
    console.error('[Session Service] Parent message generation failed:', error);
    return null;
  }

  return { message: data.message };
}

/**
 * [MIGRATION POINT: Audio Processing]
 * Triggers audio transcription and summarization.
 * Called from: /src/pages/Listen.tsx after upload
 */
export async function triggerAudioProcessing(sessionId: string): Promise<boolean> {
  const { error } = await supabase.functions.invoke('process-session', {
    body: { sessionId },
  });

  if (error) {
    console.error('[Session Service] Audio processing trigger failed:', error);
    return false;
  }

  return true;
}
