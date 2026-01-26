/**
 * =============================================================================
 * PROCESSING PAGE (/processing/:sessionId)
 * =============================================================================
 * 
 * NEXT.JS MIGRATION: app/processing/[sessionId]/page.tsx
 * 
 * PURPOSE: Display audio processing status with polling.
 * 
 * DATA FLOW:
 * 1. [POLL] Check session status every 2 seconds
 * 2. [REDIRECT] Navigate to /session/:id on completion
 * 3. [ERROR] Show retry button on failure
 * 
 * This page is part of the AUDIO FLOW (beta):
 * Listen → Processing → Session
 * =============================================================================
 */

import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useGuestMode } from '@/hooks/useGuestMode';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, ArrowLeft } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export default function Processing() {
  const { sessionId } = useParams();
  const { user, loading: authLoading } = useAuth();
  const { isGuest } = useGuestMode();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [status, setStatus] = useState<string>('processing');
  const [error, setError] = useState<string | null>(null);

  // [AUTH GUARD] Redirect unauthenticated/guest users (guests can't have saved sessions)
  useEffect(() => {
    if (!authLoading && (!user || isGuest)) {
      navigate('/auth', { replace: true });
    }
    if (!sessionId) {
      navigate('/', { replace: true });
    }
  }, [user, authLoading, sessionId, isGuest, navigate]);

  // [POLL] Check session status periodically
  useEffect(() => {
    if (!sessionId || !user) return;

    const pollStatus = async () => {
      // [MIGRATION POINT: Status Polling]
      const { data, error } = await supabase
        .from('sessions')
        .select('status, error_message')
        .eq('id', sessionId)
        .single();

      if (error) {
        setError('Failed to check status');
        return;
      }

      setStatus(data.status);

      // [REDIRECT] Navigate to session page on completion
      if (data.status === 'completed') {
        navigate(`/session/${sessionId}`);
      } else if (data.status === 'failed') {
        setError(data.error_message || 'Processing failed. Please try again.');
      }
    };

    pollStatus();
    const interval = setInterval(pollStatus, 2000);

    return () => clearInterval(interval);
  }, [sessionId, user, navigate]);

  // [RETRY] Reset status and re-trigger processing
  const handleRetry = async () => {
    if (!sessionId) return;

    setError(null);
    setStatus('processing');

    try {
      // [MIGRATION POINT: Session Status Reset]
      await supabase
        .from('sessions')
        .update({ status: 'processing', error_message: null })
        .eq('id', sessionId);

      // [MIGRATION POINT: AI Processing Trigger]
      // In Next.js, replace with server action
      await supabase.functions.invoke('process-session', {
        body: { sessionId }
      });

    } catch (err) {
      toast({
        title: 'Error',
        description: 'Failed to retry processing.',
        variant: 'destructive',
      });
    }
  };

  if (authLoading) {
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
          className="text-muted-foreground"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Home
        </Button>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 pb-20">
        <div className="text-center max-w-md mx-auto animate-fade-in">
          {error ? (
            <>
              {/* Error State */}
              <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-6">
                <span className="text-3xl">😔</span>
              </div>
              <h1 className="text-2xl font-semibold mb-3 text-foreground">
                Something went wrong
              </h1>
              <p className="text-muted-foreground mb-8">
                {error}
              </p>
              <Button
                variant="hero"
                onClick={handleRetry}
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Try Again
              </Button>
            </>
          ) : (
            <>
              {/* Processing State */}
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
              </div>
              <h1 className="text-2xl font-semibold mb-3 text-foreground">
                Creating your summary…
              </h1>
              <p className="text-muted-foreground mb-8">
                Bottor is listening to your recording and generating insights.
                This usually takes about 30 seconds.
              </p>
              
              {/* Progress dots animation */}
              <div className="flex items-center justify-center gap-2">
                <div className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
