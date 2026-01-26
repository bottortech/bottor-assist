import { useState, useRef, useCallback, useEffect } from 'react';

// Web Speech API types
interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent {
  error: string;
  message?: string;
}

interface SpeechRecognitionResult {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult[];
  [index: number]: SpeechRecognitionResultItem;
}

interface SpeechRecognitionResultItem {
  isFinal: boolean;
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

// Declare global SpeechRecognition types
declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
  }
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onspeechstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export type SpeechStatus = 'idle' | 'listening' | 'paused' | 'stopped-silence';

export interface UseSpeechRecognitionReturn {
  isSupported: boolean;
  isListening: boolean;
  status: SpeechStatus;
  liveCaption: string;
  fullTranscript: string;
  noSpeechWarning: boolean;
  silenceSeconds: number;
  start: () => void;
  stop: () => void;
  clearTranscript: () => void;
  reset: () => void;
}

const NO_SPEECH_WARNING_TIMEOUT = 2000; // 2 seconds - show warning
const PAUSE_THRESHOLD = 1000; // 1 second - show "paused" status
const SILENCE_TIMEOUT = 10000; // 10 seconds - stop recording
const RESTART_DELAY = 300; // 300ms delay before auto-restart

export function useSpeechRecognition(): UseSpeechRecognitionReturn {
  const [isListening, setIsListening] = useState(false);
  const [status, setStatus] = useState<SpeechStatus>('idle');
  const [liveCaption, setLiveCaption] = useState('');
  const [fullTranscript, setFullTranscript] = useState('');
  const [noSpeechWarning, setNoSpeechWarning] = useState(false);
  const [silenceSeconds, setSilenceSeconds] = useState(0);
  
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const noSpeechTimerRef = useRef<number | null>(null);
  const silenceWatchdogRef = useRef<number | null>(null);
  const restartTimerRef = useRef<number | null>(null);
  const lastSpeechAtRef = useRef<number>(Date.now());
  const hasReceivedSpeechRef = useRef(false);
  const isActiveRef = useRef(false);
  const manualStopRequestedRef = useRef(false);
  
  const SpeechRecognitionAPI = typeof window !== 'undefined' 
    ? window.SpeechRecognition || window.webkitSpeechRecognition 
    : null;
  
  const isSupported = !!SpeechRecognitionAPI;

  const clearNoSpeechTimer = useCallback(() => {
    if (noSpeechTimerRef.current) {
      clearTimeout(noSpeechTimerRef.current);
      noSpeechTimerRef.current = null;
    }
  }, []);

  const clearSilenceWatchdog = useCallback(() => {
    if (silenceWatchdogRef.current) {
      clearInterval(silenceWatchdogRef.current);
      silenceWatchdogRef.current = null;
    }
  }, []);

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  const stopInternal = useCallback(() => {
    console.log('[SpeechRecognition] stopInternal called');
    isActiveRef.current = false;
    clearNoSpeechTimer();
    clearSilenceWatchdog();
    clearRestartTimer();
    setSilenceSeconds(0);
    
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {
        // Ignore
      }
    }
    
    setIsListening(false);
    setLiveCaption('');
  }, [clearNoSpeechTimer, clearRestartTimer, clearSilenceWatchdog]);

  const startNoSpeechTimer = useCallback(() => {
    clearNoSpeechTimer();
    noSpeechTimerRef.current = window.setTimeout(() => {
      if (!hasReceivedSpeechRef.current && isActiveRef.current) {
        setNoSpeechWarning(true);
      }
    }, NO_SPEECH_WARNING_TIMEOUT);
  }, [clearNoSpeechTimer]);

  // Reset silence timer - called on any speech activity
  const resetSilenceTimer = useCallback(() => {
    lastSpeechAtRef.current = Date.now();
    setSilenceSeconds(0);
    setStatus('listening');
  }, []);

  // Silence watchdog - checks every 250ms for silence duration
  const startSilenceWatchdog = useCallback(() => {
    clearSilenceWatchdog();
    
    silenceWatchdogRef.current = window.setInterval(() => {
      if (!isActiveRef.current) {
        clearSilenceWatchdog();
        return;
      }
      
      const silenceDuration = Date.now() - lastSpeechAtRef.current;
      const seconds = Math.floor(silenceDuration / 1000);
      setSilenceSeconds(seconds);
      
      if (silenceDuration >= SILENCE_TIMEOUT) {
        // 10+ seconds of silence - stop recording
        console.log('[SpeechRecognition] Stopping due to 10s silence');
        manualStopRequestedRef.current = true; // Prevent auto-restart
        setStatus('stopped-silence');
        stopInternal();
      } else if (silenceDuration >= PAUSE_THRESHOLD) {
        // 1-10 seconds - show paused status
        setStatus('paused');
      } else {
        // Active speech
        setStatus('listening');
      }
    }, 250);
  }, [clearSilenceWatchdog, stopInternal]);

  const createRecognition = useCallback(() => {
    if (!SpeechRecognitionAPI) return null;
    
    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onspeechstart = () => {
      console.log('[SpeechRecognition] onspeechstart fired');
      resetSilenceTimer();
      hasReceivedSpeechRef.current = true;
      setNoSpeechWarning(false);
      clearNoSpeechTimer();
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      // Update last speech timestamp on every result
      resetSilenceTimer();
      hasReceivedSpeechRef.current = true;
      setNoSpeechWarning(false);
      clearNoSpeechTimer();
      
      let interim = '';
      let final = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        
        if (result.isFinal) {
          // Add proper punctuation/spacing
          let text = transcript.trim();
          // Add period if doesn't end with punctuation
          if (text && !/[.!?]$/.test(text)) {
            text += '.';
          }
          final += text + ' ';
        } else {
          interim = transcript;
        }
      }

      if (final) {
        setFullTranscript(prev => prev + final);
        setLiveCaption('');
      } else if (interim) {
        setLiveCaption(interim);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.warn('[SpeechRecognition] Error:', event.error);
      
      // Don't show warning for expected errors
      if (event.error === 'no-speech') {
        if (!hasReceivedSpeechRef.current) {
          setNoSpeechWarning(true);
        }
        // Don't stop on no-speech error - let the silence watchdog handle it
      } else if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        console.error('[SpeechRecognition] Permission denied');
        manualStopRequestedRef.current = true;
        stopInternal();
        setStatus('idle');
      } else if (event.error !== 'aborted') {
        console.error('[SpeechRecognition] Unexpected error:', event.error);
      }
    };

    recognition.onend = () => {
      const silenceDuration = Date.now() - lastSpeechAtRef.current;
      console.log('[SpeechRecognition] onend fired, isActive:', isActiveRef.current, 
        'manualStop:', manualStopRequestedRef.current, 
        'silenceDuration:', Math.round(silenceDuration / 1000) + 's');
      
      // Only auto-restart if:
      // 1. Still in active recording mode
      // 2. User didn't manually click stop
      // 3. Silence hasn't exceeded threshold
      if (isActiveRef.current && !manualStopRequestedRef.current && silenceDuration < SILENCE_TIMEOUT) {
        console.log('[SpeechRecognition] Scheduling auto-restart');
        clearRestartTimer();
        
        restartTimerRef.current = window.setTimeout(() => {
          if (!isActiveRef.current || manualStopRequestedRef.current) {
            console.log('[SpeechRecognition] Cancelled restart - no longer active');
            return;
          }
          
          try {
            console.log('[SpeechRecognition] Auto-restarting...');
            recognition.start();
          } catch (e) {
            console.warn('[SpeechRecognition] Failed to restart:', e);
            // If restart fails, try creating a fresh instance
            const newRecognition = createRecognition();
            if (newRecognition) {
              recognitionRef.current = newRecognition;
              try {
                newRecognition.start();
                console.log('[SpeechRecognition] Restarted with fresh instance');
              } catch (e2) {
                console.error('[SpeechRecognition] Fresh instance also failed:', e2);
                setIsListening(false);
                setStatus('idle');
                isActiveRef.current = false;
              }
            }
          }
        }, RESTART_DELAY);
      } else if (silenceDuration >= SILENCE_TIMEOUT) {
        // Exceeded silence threshold - ensure stopped
        console.log('[SpeechRecognition] Not restarting - exceeded silence threshold');
        setStatus('stopped-silence');
        setIsListening(false);
        isActiveRef.current = false;
        clearSilenceWatchdog();
      } else if (manualStopRequestedRef.current) {
        console.log('[SpeechRecognition] Not restarting - manual stop requested');
        setIsListening(false);
        setStatus('idle');
        isActiveRef.current = false;
      }
    };

    return recognition;
  }, [SpeechRecognitionAPI, clearNoSpeechTimer, clearRestartTimer, clearSilenceWatchdog, resetSilenceTimer, stopInternal]);

  const start = useCallback(() => {
    if (!SpeechRecognitionAPI) {
      console.warn('[SpeechRecognition] Not supported in this browser');
      return;
    }

    console.log('[SpeechRecognition] Starting...');
    
    // Reset flags
    manualStopRequestedRef.current = false;
    
    // Clear any pending restart
    clearRestartTimer();

    // Stop any existing recognition
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch (e) {
        // Ignore
      }
    }

    const recognition = createRecognition();
    if (!recognition) return;

    try {
      recognition.start();
      recognitionRef.current = recognition;
      isActiveRef.current = true;
      hasReceivedSpeechRef.current = false;
      lastSpeechAtRef.current = Date.now();
      setSilenceSeconds(0);
      setIsListening(true);
      setStatus('listening');
      setNoSpeechWarning(false);
      startNoSpeechTimer();
      startSilenceWatchdog();
      console.log('[SpeechRecognition] Started successfully');
    } catch (e) {
      console.error('[SpeechRecognition] Failed to start:', e);
    }
  }, [SpeechRecognitionAPI, clearRestartTimer, createRecognition, startNoSpeechTimer, startSilenceWatchdog]);

  const stop = useCallback(() => {
    console.log('[SpeechRecognition] Manual stop requested');
    manualStopRequestedRef.current = true;
    setStatus('idle');
    stopInternal();
  }, [stopInternal]);

  const clearTranscript = useCallback(() => {
    setFullTranscript('');
    setLiveCaption('');
  }, []);

  const reset = useCallback(() => {
    manualStopRequestedRef.current = true;
    stop();
    clearTranscript();
    setNoSpeechWarning(false);
    hasReceivedSpeechRef.current = false;
    setSilenceSeconds(0);
  }, [clearTranscript, stop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      console.log('[SpeechRecognition] Cleanup on unmount');
      isActiveRef.current = false;
      manualStopRequestedRef.current = true;
      clearNoSpeechTimer();
      clearSilenceWatchdog();
      clearRestartTimer();
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (e) {
          // Ignore
        }
      }
    };
  }, [clearNoSpeechTimer, clearRestartTimer, clearSilenceWatchdog]);

  return {
    isSupported,
    isListening,
    status,
    liveCaption,
    fullTranscript,
    noSpeechWarning,
    silenceSeconds,
    start,
    stop,
    clearTranscript,
    reset,
  };
}
