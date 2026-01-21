import { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Mic, Square, ArrowLeft } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export default function Listen() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('sessionId');
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [isUploading, setIsUploading] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      navigate('/auth', { replace: true });
    }
    if (!sessionId) {
      navigate('/', { replace: true });
    }
  }, [user, loading, sessionId, navigate]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (mediaRecorderRef.current && isRecording) {
        mediaRecorderRef.current.stop();
      }
    };
  }, [isRecording]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });
      
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        await handleUpload();
      };

      mediaRecorder.start(1000); // Collect data every second
      setIsRecording(true);
      setDuration(0);

      timerRef.current = window.setInterval(() => {
        setDuration(prev => prev + 1);
      }, 1000);

    } catch (error) {
      toast({
        title: 'Microphone Access Required',
        description: 'Please allow microphone access to record your lesson.',
        variant: 'destructive',
      });
    }
  };

  const stopRecording = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const handleUpload = async () => {
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
          duration_seconds: duration,
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

          {/* Helper text */}
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
