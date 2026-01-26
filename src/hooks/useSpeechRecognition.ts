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
  start: () => void;
  stop: () => void;
  reset: () => void;
}

const NO_SPEECH_WARNING_TIMEOUT = 2000; // 2 seconds - show warning
const PAUSE_THRESHOLD = 1000; // 1 second - show "paused" status
const SILENCE_TIMEOUT = 10000; // 10 seconds - stop recording

export function useSpeechRecognition(): UseSpeechRecognitionReturn {
  const [isListening, setIsListening] = useState(false);
  const [status, setStatus] = useState<SpeechStatus>('idle');
  const [liveCaption, setLiveCaption] = useState('');
  const [fullTranscript, setFullTranscript] = useState('');
  const [noSpeechWarning, setNoSpeechWarning] = useState(false);
  
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const noSpeechTimerRef = useRef<number | null>(null);
  const silenceWatchdogRef = useRef<number | null>(null);
  const lastSpeechAtRef = useRef<number>(Date.now());
  const hasReceivedSpeechRef = useRef(false);
  const isActiveRef = useRef(false);
  const stoppedBySilenceRef = useRef(false);
  
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

  const stopInternal = useCallback(() => {
    isActiveRef.current = false;
    clearNoSpeechTimer();
    clearSilenceWatchdog();
    
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {
        // Ignore
      }
      recognitionRef.current = null;
    }
    
    setIsListening(false);
    setLiveCaption('');
  }, [clearNoSpeechTimer, clearSilenceWatchdog]);

  const startNoSpeechTimer = useCallback(() => {
    clearNoSpeechTimer();
    noSpeechTimerRef.current = window.setTimeout(() => {
      if (!hasReceivedSpeechRef.current && isActiveRef.current) {
        setNoSpeechWarning(true);
      }
    }, NO_SPEECH_WARNING_TIMEOUT);
  }, [clearNoSpeechTimer]);

  // Silence watchdog - checks every 250ms for silence duration
  const startSilenceWatchdog = useCallback(() => {
    clearSilenceWatchdog();
    
    silenceWatchdogRef.current = window.setInterval(() => {
      if (!isActiveRef.current) {
        clearSilenceWatchdog();
        return;
      }
      
      const silenceDuration = Date.now() - lastSpeechAtRef.current;
      
      if (silenceDuration >= SILENCE_TIMEOUT) {
        // 10+ seconds of silence - stop recording
        console.log('[SpeechRecognition] Stopping due to 10s silence');
        stoppedBySilenceRef.current = true;
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

  const start = useCallback(() => {
    if (!SpeechRecognitionAPI) {
      console.warn('[SpeechRecognition] Not supported in this browser');
      return;
    }

    // Reset silence stop flag
    stoppedBySilenceRef.current = false;

    // Stop any existing recognition
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {
        // Ignore
      }
    }

    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      // Update last speech timestamp on every result
      lastSpeechAtRef.current = Date.now();
      hasReceivedSpeechRef.current = true;
      setNoSpeechWarning(false);
      setStatus('listening');
      clearNoSpeechTimer();
      
      let interim = '';
      let final = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        
        if (result.isFinal) {
          final += transcript + ' ';
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
      } else if (event.error !== 'aborted') {
        console.error('[SpeechRecognition] Unexpected error:', event.error);
      }
    };

    recognition.onend = () => {
      console.log('[SpeechRecognition] Ended, isActive:', isActiveRef.current);
      
      // Check if we should restart or stay stopped
      if (isActiveRef.current) {
        const silenceDuration = Date.now() - lastSpeechAtRef.current;
        
        if (silenceDuration < SILENCE_TIMEOUT) {
          // Still within silence threshold - auto-restart
          try {
            recognition.start();
            console.log('[SpeechRecognition] Auto-restarted (silence:', Math.round(silenceDuration / 1000), 's)');
          } catch (e) {
            console.warn('[SpeechRecognition] Failed to restart:', e);
            setIsListening(false);
            setStatus('idle');
            isActiveRef.current = false;
          }
        } else {
          // Exceeded silence threshold - stop
          console.log('[SpeechRecognition] Not restarting - exceeded silence threshold');
          stoppedBySilenceRef.current = true;
          setStatus('stopped-silence');
          setIsListening(false);
          isActiveRef.current = false;
          clearSilenceWatchdog();
        }
      } else {
        setIsListening(false);
        if (!stoppedBySilenceRef.current) {
          setStatus('idle');
        }
      }
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
      isActiveRef.current = true;
      hasReceivedSpeechRef.current = false;
      lastSpeechAtRef.current = Date.now();
      setIsListening(true);
      setStatus('listening');
      setNoSpeechWarning(false);
      startNoSpeechTimer();
      startSilenceWatchdog();
      console.log('[SpeechRecognition] Started');
    } catch (e) {
      console.error('[SpeechRecognition] Failed to start:', e);
    }
  }, [SpeechRecognitionAPI, clearNoSpeechTimer, startNoSpeechTimer, startSilenceWatchdog, clearSilenceWatchdog]);

  const stop = useCallback(() => {
    stoppedBySilenceRef.current = false;
    setStatus('idle');
    stopInternal();
  }, [stopInternal]);

  const reset = useCallback(() => {
    stop();
    setFullTranscript('');
    setNoSpeechWarning(false);
    hasReceivedSpeechRef.current = false;
  }, [stop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isActiveRef.current = false;
      clearNoSpeechTimer();
      clearSilenceWatchdog();
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (e) {
          // Ignore
        }
      }
    };
  }, [clearNoSpeechTimer, clearSilenceWatchdog]);

  return {
    isSupported,
    isListening,
    status,
    liveCaption,
    fullTranscript,
    noSpeechWarning,
    start,
    stop,
    reset,
  };
}