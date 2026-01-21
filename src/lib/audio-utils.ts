/**
 * Audio utilities for WAV conversion, volume normalization, and validation
 */

const TARGET_SAMPLE_RATE = 16000; // 16kHz for optimal transcription
const MIN_BLOB_SIZE = 5 * 1024; // 5KB minimum
const MIN_RMS_THRESHOLD = 0.005; // Minimum RMS level

/**
 * Convert an audio Blob to WAV format (16-bit PCM, 16kHz)
 */
export async function convertToWav(blob: Blob): Promise<Blob> {
  const arrayBuffer = await blob.arrayBuffer();
  
  // Decode the audio using Web Audio API
  const audioContext = new OfflineAudioContext(1, 1, TARGET_SAMPLE_RATE);
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  
  // Resample to target sample rate
  const resampledBuffer = await resampleAudio(audioBuffer, TARGET_SAMPLE_RATE);
  
  // Normalize volume
  const normalizedSamples = normalizeVolume(resampledBuffer.getChannelData(0));
  
  // Encode to WAV
  const wavBuffer = encodeWav(normalizedSamples, TARGET_SAMPLE_RATE);
  
  return new Blob([wavBuffer], { type: 'audio/wav' });
}

/**
 * Resample audio to target sample rate
 */
async function resampleAudio(audioBuffer: AudioBuffer, targetSampleRate: number): Promise<AudioBuffer> {
  const numSamples = Math.round(audioBuffer.duration * targetSampleRate);
  const offlineContext = new OfflineAudioContext(1, numSamples, targetSampleRate);
  
  const bufferSource = offlineContext.createBufferSource();
  bufferSource.buffer = audioBuffer;
  bufferSource.connect(offlineContext.destination);
  bufferSource.start(0);
  
  return await offlineContext.startRendering();
}

/**
 * Normalize audio volume to prevent clipping and ensure consistent levels
 */
function normalizeVolume(samples: Float32Array): Float32Array {
  // Find peak amplitude
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]);
    if (abs > peak) peak = abs;
  }
  
  // Normalize to 0.9 to leave headroom
  const targetPeak = 0.9;
  const gain = peak > 0 ? targetPeak / peak : 1;
  
  const normalized = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    normalized[i] = samples[i] * gain;
  }
  
  return normalized;
}

/**
 * Encode audio samples to WAV format (16-bit PCM)
 */
function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const dataLength = samples.length * bytesPerSample;
  const bufferLength = 44 + dataLength; // 44 bytes for WAV header
  
  const buffer = new ArrayBuffer(bufferLength);
  const view = new DataView(buffer);
  
  // WAV header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, bufferLength - 8, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true); // byte rate
  view.setUint16(32, numChannels * bytesPerSample, true); // block align
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);
  
  // Write audio samples as 16-bit PCM
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
    view.setInt16(offset, int16, true);
    offset += 2;
  }
  
  return buffer;
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

/**
 * Calculate RMS (Root Mean Square) level of audio samples
 */
export function calculateRMS(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * Validate audio blob meets minimum requirements
 */
export async function validateAudioBlob(blob: Blob): Promise<{ valid: boolean; reason?: string; rms?: number }> {
  // Check minimum size
  if (blob.size < MIN_BLOB_SIZE) {
    return { valid: false, reason: 'Recording too short (less than 5KB)' };
  }
  
  try {
    // Decode and check RMS level
    const arrayBuffer = await blob.arrayBuffer();
    const audioContext = new AudioContext();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const samples = audioBuffer.getChannelData(0);
    const rms = calculateRMS(samples);
    
    await audioContext.close();
    
    if (rms < MIN_RMS_THRESHOLD) {
      return { valid: false, reason: 'Audio level too low - check your microphone', rms };
    }
    
    return { valid: true, rms };
  } catch (error) {
    console.error('[Audio] Validation error:', error);
    return { valid: false, reason: 'Could not process audio file' };
  }
}

/**
 * Get audio duration in seconds from samples and sample rate
 */
export function getAudioDuration(sampleCount: number, sampleRate: number): number {
  return sampleCount / sampleRate;
}
