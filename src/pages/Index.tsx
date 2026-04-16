/**
 * =============================================================================
 * HOME PAGE (/)
 * =============================================================================
 *
 * PURPOSE: Minimal entry point — single primary action (Start Grading).
 * Sample grading lives inside Step 1 of the grading flow, not on the home screen.
 *
 * Future-ready: Google Classroom and grading history are intentionally not
 * shown in the UI yet, but related routes/handlers remain available elsewhere
 * in the codebase so they can be reintroduced after auth/dashboard work.
 * =============================================================================
 */

import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useGuestMode } from '@/hooks/useGuestMode';
import { Button } from '@/components/ui/button';
import { ClipboardList } from 'lucide-react';
import { BottorLogo } from '@/components/BottorLogo';
import { AppHeader } from '@/components/AppHeader';

export default function Index() {
  const { user, loading, signOut } = useAuth();
  const { isGuest, enterGuestMode, exitGuestMode } = useGuestMode();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    if (isGuest) {
      exitGuestMode();
    } else {
      await signOut();
    }
    navigate('/auth');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const hasAccess = user || isGuest;

  const handleStartGrading = () => {
    if (!hasAccess) enterGuestMode();
    navigate('/grade');
  };

  const Hero = (
    <main className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 pb-20 min-h-[calc(100vh-120px)] w-full">
      <div className="flex flex-col items-center justify-center text-center w-full max-w-md mx-auto animate-fade-in">
        <div className="mb-6">
          <BottorLogo size={88} className="mx-auto" />
        </div>

        <h1 className="text-[32px] sm:text-[40px] font-bold mb-3 text-primary">
          Bottor Assist
        </h1>
        <p className="text-lg sm:text-xl text-secondary-foreground font-medium mb-1">
          Grade with your rubric.
        </p>
        <p className="text-lg sm:text-xl text-secondary-foreground font-medium mb-10">
          You review. You decide.
        </p>

        <div className="w-full max-w-[320px] space-y-4">
          <Button
            variant="hero"
            size="xl"
            onClick={handleStartGrading}
            className="w-full h-12"
          >
            <ClipboardList className="w-5 h-5 mr-2" />
            {hasAccess ? 'Start Grading Session' : 'Start grading (no account needed)'}
          </Button>

          {!hasAccess && (
            <button
              type="button"
              onClick={() => navigate('/auth')}
              className="w-full text-sm text-muted-foreground hover:text-foreground hover:underline transition-colors"
            >
              Sign in with an account
            </button>
          )}
        </div>
      </div>
    </main>
  );

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {hasAccess && <AppHeader onSignOut={handleSignOut} />}
      {Hero}
      <footer className="py-[18px] text-center border-t border-border">
        <p className="text-[13px] text-[hsl(218,11%,65%)]">
          Built with teachers to reduce paperwork.
        </p>
      </footer>
    </div>
  );
}
