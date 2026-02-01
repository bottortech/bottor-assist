/**
 * =============================================================================
 * SESSION SERVICE
 * =============================================================================
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
  SummaryJson 
} from '@/types/session';

/**
 * =============================================================================
 * SESSION CREATION
 * =============================================================================
 */

/**
 * Creates a new session for audio recording mode.
 * Called from: /src/pages/Index.tsx when user clicks "Start Listening"
 */
export async function createRecordingSession(userId: string): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from('sessions')
    .insert({
      user_id: userId,
      status: 'recording' as SessionStatus,
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
 * =============================================================================
 * SESSION RETRIEVAL
 * =============================================================================
 */

/**
 * Fetches session list for /history page.
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
 * Fetches full session for /session/:id page.
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
 * Generates parent message for audio-based sessions.
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
