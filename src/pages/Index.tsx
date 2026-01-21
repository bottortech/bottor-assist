import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Mic, ListChecks, LogOut, FileText, History } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export default function Index() {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    if (!loading && !user) {
      navigate('/auth', { replace: true });
    }
  }, [user, loading, navigate]);

  const handleStartListening = async () => {
    try {
      // Create a new session
      const { data, error } = await supabase
        .from('sessions')
        .insert({
          user_id: user?.id,
          status: 'recording',
        })
        .select()
        .single();

      if (error) throw error;

      navigate(`/listen?sessionId=${data.id}`);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to create session. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
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
      <header className="p-4 flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleSignOut}
          className="text-muted-foreground"
        >
          <LogOut className="w-4 h-4 mr-2" />
          Sign Out
        </Button>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 pb-20">
        <div className="text-center max-w-md mx-auto animate-fade-in">
          {/* Logo */}
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-primary text-primary-foreground mb-6 shadow-xl">
            <Mic className="w-10 h-10" />
          </div>

          {/* Title */}
          <h1 className="text-4xl font-bold mb-3 text-gradient-primary">
            Bottor Assist
          </h1>
          <p className="text-xl text-muted-foreground mb-12">
            Teach. I'll handle the notes.
          </p>

          {/* Actions */}
          <div className="space-y-4">
            <Button
              variant="hero"
              size="xl"
              onClick={() => navigate('/quick-notes')}
              className="w-full"
            >
              <FileText className="w-5 h-5 mr-2" />
              Quick Notes (Recommended)
            </Button>

            <Button
              variant="outline"
              size="lg"
              onClick={handleStartListening}
              className="w-full"
            >
              <Mic className="w-5 h-5 mr-2" />
              Start Listening (Beta)
            </Button>

            <Button
              variant="subtle"
              size="lg"
              onClick={() => navigate('/summaries')}
              className="w-full"
            >
              <History className="w-5 h-5 mr-2" />
              History
            </Button>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Your AI copilot for the classroom
        </p>
      </footer>
    </div>
  );
}
