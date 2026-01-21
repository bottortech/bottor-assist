/**
 * =============================================================================
 * AUDIO SERVICE
 * =============================================================================
 * 
 * NEXT.JS MIGRATION NOTE:
 * This service isolates all audio capture and upload logic.
 * When migrating to Next.js:
 * - Keep browser-side audio capture logic as-is
 * - Replace supabase storage calls with Next.js API routes
 * - Consider using tRPC for type-safe uploads
 * 
 * AUDIO FLOW:
 * 1. startRecording() - Initialize MediaRecorder
 * 2. Audio chunks collected during recording
 * 3. stopRecording() - Finalize blob
 * 4. uploadAudio() - Convert to WAV, upload to storage
 * =============================================================================
 */

import { supabase } from '@/integrations/supabase/client';
import { convertToWav, validateAudioBlob } from '@/lib/audio-utils';

export interface AudioUploadResult {
  success: boolean;
  audioPath?: string;
  error?: string;
}

/**
 * [MIGRATION POINT: Audio Upload]
 * Validates, converts, and uploads audio to storage.
 * Called from: /src/pages/Listen.tsx handleUpload()
 * 
 * NEXT.JS MIGRATION:
 * - Keep validation and conversion client-side
 * - Create API route for presigned upload URL
 * - Upload directly to storage from client
 */
export async function uploadAudioRecording(
  audioBlob: Blob,
  userId: string,
  sessionId: string
): Promise<AudioUploadResult> {
  try {
    // [STEP 1] Validate audio blob
    const validation = await validateAudioBlob(audioBlob);
    if (!validation.valid) {
      console.warn('[Audio Service] Validation failed:', validation.reason);
      return {
        success: false,
        error: validation.reason || 'Recording validation failed',
      };
    }

    console.log('[Audio Service] Validation passed, RMS:', validation.rms?.toFixed(4));

    // [STEP 2] Convert to WAV format (16-bit PCM, 16kHz)
    console.log('[Audio Service] Converting to WAV...');
    const wavBlob = await convertToWav(audioBlob);
    console.log('[Audio Service] WAV blob size:', wavBlob.size);

    // [STEP 3] Upload to Supabase Storage
    const audioPath = `${userId}/${sessionId}.wav`;

    const { error: uploadError } = await supabase.storage
      .from('bottor-audio')
      .upload(audioPath, wavBlob);

    if (uploadError) {
      console.error('[Audio Service] Upload error:', uploadError);
      return {
        success: false,
        error: 'Failed to upload audio file',
      };
    }

    return {
      success: true,
      audioPath,
    };
  } catch (error) {
    console.error('[Audio Service] Upload error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown upload error',
    };
  }
}

/**
 * [MIGRATION POINT: Session Audio Update]
 * Updates session with audio path and triggers processing.
 * Called from: /src/pages/Listen.tsx after upload
 */
export async function finalizeAudioSession(
  sessionId: string,
  audioPath: string,
  durationSeconds: number
): Promise<boolean> {
  const { error: updateError } = await supabase
    .from('sessions')
    .update({
      status: 'processing',
      duration_seconds: durationSeconds,
      audio_path: audioPath,
    })
    .eq('id', sessionId);

  if (updateError) {
    console.error('[Audio Service] Session update error:', updateError);
    return false;
  }

  // Trigger AI processing
  const { error: invokeError } = await supabase.functions.invoke('process-session', {
    body: { sessionId },
  });

  if (invokeError) {
    console.error('[Audio Service] Process trigger error:', invokeError);
    return false;
  }

  return true;
}
