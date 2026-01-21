import { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Mic, Square, ArrowLeft, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription } from '@/components/ui/alert';

type RecordingState = 'inactive' | 'recording' | 'paused';

export default function Listen() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('sessionId');
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [recorderState, setRecorderState] = useState<RecordingState>('inactive');
  const [duration, setDuration] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);

  // Derived state: only true when MediaRecorder is actually recording
  const isRecording = recorderState === 'recording';

  useEffect(() => {
    if (!loading && !user) {
      navigate('/auth', { replace: true });
    }
    if (!sessionId) {
      navigate('/', { replace: true });
    }
  }, [user, loading, sessionId, navigate]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const startRecording = async () => {
    setAudioError(null);
    
    try {
      // Check if getUserMedia is available (not in iframe restrictions)
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Audio recording is not supported in this browser or context.');
      }

      console.log('[Audio] Requesting microphone access...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      console.log('[Audio] Microphone access granted, stream active:', stream.active);

      // Check for supported MIME types
      let mimeType = 'audio/webm;codecs=opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'audio/webm';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = 'audio/mp4';
          if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = ''; // Let browser choose
          }
        }
      }
      console.log('[Audio] Using MIME type:', mimeType || 'browser default');

      const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      // Log state changes for debugging
      mediaRecorder.onstart = () => {
        console.log('[Audio] MediaRecorder.state changed to:', mediaRecorder.state);
        setRecorderState('recording');
        
        // Start timer based on actual elapsed time
        startTimeRef.current = Date.now();
        setDuration(0);
        
        timerRef.current = window.setInterval(() => {
          if (startTimeRef.current) {
            const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
            setDuration(elapsed);
          }
        }, 100); // Update more frequently for accuracy
      };

      mediaRecorder.ondataavailable = (event) => {
        console.log('[Audio] Data available, size:', event.data.size);
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        console.log('[Audio] MediaRecorder.state changed to:', mediaRecorder.state);
        setRecorderState('inactive');
        
        // Stop timer
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        
        // Calculate final duration
        const finalDuration = startTimeRef.current 
          ? Math.floor((Date.now() - startTimeRef.current) / 1000)
          : duration;
        
        // Stop all tracks
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }
        
        await handleUpload(finalDuration);
      };

      mediaRecorder.onerror = (event) => {
        console.error('[Audio] MediaRecorder error:', event);
        setAudioError('Recording error occurred. Please try again.');
        setRecorderState('inactive');
        
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }
      };

      // Actually start recording
      console.log('[Audio] Calling MediaRecorder.start()...');
      mediaRecorder.start(1000); // Collect data every second
      console.log('[Audio] MediaRecorder.start() called, state:', mediaRecorder.state);

    } catch (error) {
      console.error('[Audio] Failed to start recording:', error);
      
      let errorMessage = 'Please allow microphone access to record your lesson.';
      if (error instanceof Error) {
        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
          errorMessage = 'Microphone access was denied. Please enable it in your browser settings.';
        } else if (error.name === 'NotFoundError') {
          errorMessage = 'No microphone found. Please connect a microphone and try again.';
        } else if (error.name === 'NotSupportedError' || error.message.includes('not supported')) {
          errorMessage = 'Audio recording is not supported in this browser context. Try opening in a new tab.';
        } else {
          errorMessage = error.message;
        }
      }
      
      setAudioError(errorMessage);
      toast({
        title: 'Recording Failed',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  const stopRecording = () => {
    console.log('[Audio] Stop recording requested, current state:', mediaRecorderRef.current?.state);
    
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      console.log('[Audio] Calling MediaRecorder.stop()...');
      mediaRecorderRef.current.stop();
    }
  };

  const handleUpload = async (finalDuration: number) => {
    if (!sessionId || !user || chunksRef.current.length === 0) return;

    setIsUploading(true);

    try {
      const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
      const audioPath = `${user.id}/${sessionId}.webm`;

      // Upload to storage
      const { error: uploadError } = await supabase.storage
        .from('bottor-audio')
        .upload(audioPath, audioBlob);

      if (uploadError) throw uploadError;

      // Update session
      await supabase
        .from('sessions')
        .update({
          status: 'processing',
          duration_seconds: finalDuration,
          audio_path: audioPath,
        })
        .eq('id', sessionId);

      // Trigger processing
      await supabase.functions.invoke('process-session', {
        body: { sessionId }
      });

      navigate(`/processing/${sessionId}`);

    } catch (error) {
      console.error('Upload error:', error);
      toast({
        title: 'Upload Failed',
        description: 'Failed to upload recording. Please try again.',
        variant: 'destructive',
      });
      setIsUploading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-bottor-gradient flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bottor-gradient flex flex-col">
      {/* Header */}
      <header className="p-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/')}
          disabled={isRecording || isUploading}
          className="text-muted-foreground"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 pb-20">
        <div className="text-center max-w-md mx-auto animate-fade-in">
          {/* Error Display */}
          {audioError && (
            <Alert variant="destructive" className="mb-6 text-left">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{audioError}</AlertDescription>
            </Alert>
          )}

          {/* Status Text */}
          <h1 className="text-2xl font-semibold mb-2 text-foreground">
            {isUploading 
              ? 'Uploading recording...' 
              : isRecording 
                ? 'Bottor is listening…' 
                : 'Ready to record'}
          </h1>
          <p className="text-muted-foreground mb-12">
            {isUploading
              ? 'Please wait while we process your audio'
              : isRecording
                ? 'Tap to stop when your lesson is complete'
                : 'Tap the microphone to begin'}
          </p>

          {/* Timer */}
          <div className="text-5xl font-mono font-bold mb-12 text-foreground tabular-nums">
            {formatDuration(duration)}
          </div>

          {/* Recording Button */}
          <div className="relative inline-flex items-center justify-center">
            {/* Animated rings when recording */}
            {isRecording && (
              <>
                <div className="absolute inset-0 rounded-full bg-accent/20 animate-recording-ring" />
                <div className="absolute inset-0 rounded-full bg-accent/10 animate-recording-ring" style={{ animationDelay: '0.5s' }} />
              </>
            )}
            
            <Button
              variant={isRecording ? 'recording' : 'hero'}
              size="icon-2xl"
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isUploading}
              className={`relative z-10 ${isRecording ? 'bg-accent animate-listening' : ''}`}
            >
              {isUploading ? (
                <div className="w-8 h-8 border-4 border-primary-foreground border-t-transparent rounded-full animate-spin" />
              ) : isRecording ? (
                <Square className="w-10 h-10 fill-current" />
              ) : (
                <Mic className="w-12 h-12" />
              )}
            </Button>
          </div>

          {/* Helper text - only show when MediaRecorder is actually recording */}
          {isRecording && (
            <p className="mt-8 text-sm text-muted-foreground animate-fade-in">
              Recording in progress...
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
