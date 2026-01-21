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

export interface UseSpeechRecognitionReturn {
  isSupported: boolean;
  isListening: boolean;
  liveCaption: string;
  fullTranscript: string;
  noSpeechWarning: boolean;
  start: () => void;
  stop: () => void;
  reset: () => void;
}

const NO_SPEECH_TIMEOUT = 2000; // 2 seconds

export function useSpeechRecognition(): UseSpeechRecognitionReturn {
  const [isListening, setIsListening] = useState(false);
  const [liveCaption, setLiveCaption] = useState('');
  const [fullTranscript, setFullTranscript] = useState('');
  const [noSpeechWarning, setNoSpeechWarning] = useState(false);
  
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const noSpeechTimerRef = useRef<number | null>(null);
  const hasReceivedSpeechRef = useRef(false);
  const isActiveRef = useRef(false);
  
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

  const startNoSpeechTimer = useCallback(() => {
    clearNoSpeechTimer();
    noSpeechTimerRef.current = window.setTimeout(() => {
      if (!hasReceivedSpeechRef.current && isActiveRef.current) {
        setNoSpeechWarning(true);
      }
    }, NO_SPEECH_TIMEOUT);
  }, [clearNoSpeechTimer]);

  const start = useCallback(() => {
    if (!SpeechRecognitionAPI) {
      console.warn('[SpeechRecognition] Not supported in this browser');
      return;
    }

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
      hasReceivedSpeechRef.current = true;
      setNoSpeechWarning(false);
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
      } else if (event.error !== 'aborted') {
        console.error('[SpeechRecognition] Unexpected error:', event.error);
      }
    };

    recognition.onend = () => {
      console.log('[SpeechRecognition] Ended, isActive:', isActiveRef.current);
      
      // Restart if still supposed to be listening (continuous mode)
      if (isActiveRef.current) {
        try {
          recognition.start();
          console.log('[SpeechRecognition] Restarted');
        } catch (e) {
          console.warn('[SpeechRecognition] Failed to restart:', e);
          setIsListening(false);
          isActiveRef.current = false;
        }
      } else {
        setIsListening(false);
      }
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
      isActiveRef.current = true;
      hasReceivedSpeechRef.current = false;
      setIsListening(true);
      setNoSpeechWarning(false);
      startNoSpeechTimer();
      console.log('[SpeechRecognition] Started');
    } catch (e) {
      console.error('[SpeechRecognition] Failed to start:', e);
    }
  }, [SpeechRecognitionAPI, clearNoSpeechTimer, startNoSpeechTimer]);

  const stop = useCallback(() => {
    isActiveRef.current = false;
    clearNoSpeechTimer();
    
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
  }, [clearNoSpeechTimer]);

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
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (e) {
          // Ignore
        }
      }
    };
  }, [clearNoSpeechTimer]);

  return {
    isSupported,
    isListening,
    liveCaption,
    fullTranscript,
    noSpeechWarning,
    start,
    stop,
    reset,
  };
}
