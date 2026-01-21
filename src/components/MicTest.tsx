import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Mic, Play, RotateCcw, CheckCircle, AlertTriangle } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

interface MicTestProps {
  selectedDeviceId?: string;
  onComplete: () => void;
  onSkip: () => void;
}

const TEST_DURATION = 5; // 5 seconds

type TestState = 'idle' | 'recording' | 'recorded' | 'playing';

export function MicTest({ selectedDeviceId, onComplete, onSkip }: MicTestProps) {
  const [state, setState] = useState<TestState>('idle');
  const [countdown, setCountdown] = useState(TEST_DURATION);
  const [audioLevel, setAudioLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const audioBlobUrlRef = useRef<string | null>(null);

  // Cleanup function
  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
      if (audioBlobUrlRef.current) {
        URL.revokeObjectURL(audioBlobUrlRef.current);
      }
    };
  }, [cleanup]);

  // Audio level monitoring
  const updateAudioLevel = useCallback(() => {
    if (!analyserRef.current) return;
    
    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);
    
    const average = dataArray.reduce((sum, val) => sum + val, 0) / dataArray.length;
    const level = Math.min(100, Math.round((average / 255) * 100 * 2));
    
    setAudioLevel(level);
    animationFrameRef.current = requestAnimationFrame(updateAudioLevel);
  }, []);

  const startRecording = async () => {
    setError(null);
    chunksRef.current = [];
    
    try {
      const audioConstraints: MediaTrackConstraints = selectedDeviceId
        ? { deviceId: { exact: selectedDeviceId }, echoCancellation: true, noiseSuppression: true }
        : { echoCancellation: true, noiseSuppression: true };

      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      streamRef.current = stream;

      // Set up audio context for level monitoring
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.5;
      source.connect(analyser);
      analyserRef.current = analyser;
      
      updateAudioLevel();

      // Set up MediaRecorder
      let mimeType = 'audio/webm;codecs=opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'audio/webm';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = '';
        }
      }

      const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        // Create audio blob for playback
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        if (audioBlobUrlRef.current) {
          URL.revokeObjectURL(audioBlobUrlRef.current);
        }
        audioBlobUrlRef.current = URL.createObjectURL(blob);
        
        // Cleanup recording resources
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
        if (audioContextRef.current) {
          audioContextRef.current.close();
          audioContextRef.current = null;
        }
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }
        
        setAudioLevel(0);
        setState('recorded');
      };

      // Start recording
      mediaRecorder.start(100);
      setState('recording');
      setCountdown(TEST_DURATION);

      // Countdown timer
      timerRef.current = window.setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            // Stop recording when countdown reaches 0
            if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
              mediaRecorderRef.current.stop();
            }
            if (timerRef.current) {
              clearInterval(timerRef.current);
              timerRef.current = null;
            }
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

    } catch (err) {
      console.error('[MicTest] Recording error:', err);
      setError('Could not access microphone. Please check permissions.');
      setState('idle');
    }
  };

  const playRecording = () => {
    if (!audioBlobUrlRef.current) return;

    const audio = new Audio(audioBlobUrlRef.current);
    audioRef.current = audio;
    
    audio.onended = () => {
      setState('recorded');
    };

    audio.onerror = () => {
      setError('Could not play recording. Please try again.');
      setState('recorded');
    };

    audio.play();
    setState('playing');
  };

  const resetTest = () => {
    cleanup();
    if (audioBlobUrlRef.current) {
      URL.revokeObjectURL(audioBlobUrlRef.current);
      audioBlobUrlRef.current = null;
    }
    chunksRef.current = [];
    setState('idle');
    setCountdown(TEST_DURATION);
    setAudioLevel(0);
    setError(null);
  };

  const progress = state === 'recording' 
    ? ((TEST_DURATION - countdown) / TEST_DURATION) * 100 
    : 0;

  return (
    <div className="bg-card/50 backdrop-blur-sm rounded-2xl p-6 w-full max-w-sm border border-border/50">
      <h3 className="text-lg font-semibold text-foreground mb-2 text-center">
        Test Your Microphone
      </h3>
      <p className="text-sm text-muted-foreground mb-6 text-center">
        Record a 5-second sample to make sure we can hear you clearly.
      </p>

      {error && (
        <div className="flex items-center gap-2 text-accent text-sm mb-4 p-3 bg-accent/10 rounded-lg">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Recording Progress */}
      {state === 'recording' && (
        <div className="mb-6 animate-fade-in">
          <div className="flex justify-between text-xs text-muted-foreground mb-2">
            <span>Recording...</span>
            <span>{countdown}s</span>
          </div>
          <Progress value={progress} className="h-2" />
          
          {/* VU Meter */}
          <div className="mt-4">
            <div className="h-3 bg-muted rounded-full overflow-hidden">
              <div 
                className="h-full transition-all duration-75 rounded-full"
                style={{ 
                  width: `${audioLevel}%`,
                  backgroundColor: audioLevel > 50 
                    ? 'hsl(142, 71%, 45%)' 
                    : audioLevel > 20 
                      ? 'hsl(48, 96%, 53%)' 
                      : audioLevel > 5 
                        ? 'hsl(25, 95%, 53%)' 
                        : 'hsl(0, 84%, 60%)'
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-2 text-center">
              Speak now to test your microphone
            </p>
          </div>
        </div>
      )}

      {/* Playback State */}
      {state === 'playing' && (
        <div className="mb-6 animate-fade-in">
          <div className="flex items-center justify-center gap-2 text-primary">
            <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
            <span className="text-sm font-medium">Playing back...</span>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="space-y-3">
        {state === 'idle' && (
          <Button 
            onClick={startRecording} 
            className="w-full"
            size="lg"
          >
            <Mic className="w-4 h-4 mr-2" />
            Start Test Recording
          </Button>
        )}

        {state === 'recorded' && (
          <>
            <Button 
              onClick={playRecording} 
              className="w-full"
              size="lg"
            >
              <Play className="w-4 h-4 mr-2" />
              Play Recording
            </Button>
            <div className="flex gap-2">
              <Button 
                onClick={resetTest} 
                variant="outline"
                className="flex-1"
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                Try Again
              </Button>
              <Button 
                onClick={onComplete} 
                variant="default"
                className="flex-1"
              >
                <CheckCircle className="w-4 h-4 mr-2" />
                Sounds Good
              </Button>
            </div>
          </>
        )}

        {state === 'recording' && (
          <Button 
            variant="outline" 
            className="w-full opacity-50"
            disabled
          >
            Recording...
          </Button>
        )}

        {state === 'playing' && (
          <Button 
            variant="outline" 
            className="w-full opacity-50"
            disabled
          >
            Playing...
          </Button>
        )}
      </div>

      {/* Skip Link */}
      {state === 'idle' && (
        <button 
          onClick={onSkip}
          className="w-full mt-4 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Skip mic test
        </button>
      )}
    </div>
  );
}
