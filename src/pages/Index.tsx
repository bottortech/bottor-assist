/**
 * =============================================================================
 * HOME PAGE (/)
 * =============================================================================
 * 
 * PURPOSE: Entry point with navigation to Grade Papers and History.
 * 
 * DATA FLOW:
 * 1. [NAVIGATE] Route to appropriate page based on action
 * 
 * This is the main hub for all user flows.
 * Supports both authenticated users and guests (pilot mode).
 * =============================================================================
 */

import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useGuestMode } from '@/hooks/useGuestMode';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { LogOut, History, Link2, ClipboardList, BookOpen } from 'lucide-react';
import { BottorLogo } from '@/components/BottorLogo';
import { AppHeader } from '@/components/AppHeader';

export default function Index() {
  const { user, loading, signOut } = useAuth();
  const { isGuest, enterGuestMode, exitGuestMode } = useGuestMode();
  const navigate = useNavigate();

  // [AUTH] Sign out user or exit guest mode
  const handleSignOut = async () => {
    if (isGuest) {
      exitGuestMode();
    } else {
      await signOut();
    }
    navigate('/auth');
  };

  // [AUTH PROMPT] Redirect guests to auth when accessing protected features
  const handleHistoryClick = () => {
    if (isGuest) {
      navigate('/history');
    } else if (user) {
      navigate('/history');
    } else {
      navigate('/auth');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Allow access for both authenticated users AND guests
  const hasAccess = user || isGuest;

  // If no access, show login prompt instead of redirecting
  const handleStartGrading = () => {
    enterGuestMode();
    navigate('/grade');
  };

  if (!hasAccess) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <main className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 pb-20 min-h-[calc(100vh-120px)] w-full">
          <div className="flex flex-col items-center justify-center text-center w-full max-w-md mx-auto animate-fade-in">
            {/* Logo */}
            <div className="mb-6">
              <BottorLogo size={88} className="mx-auto" />
            </div>

            {/* Title */}
            <h1 className="text-[32px] sm:text-[40px] font-bold mb-3 text-primary">
              Bottor Assist
            </h1>
            <p className="text-lg sm:text-xl text-secondary-foreground font-medium mb-1">
              Grade with your rubric.
            </p>
            <p className="text-lg sm:text-xl text-secondary-foreground font-medium mb-10">
              You review. You decide.
            </p>

            {/* Actions */}
            <div className="space-y-4 w-full max-w-[320px]">
              <Button
                variant="hero"
                size="xl"
                onClick={handleStartGrading}
                className="w-full h-12"
              >
                <ClipboardList className="w-5 h-5 mr-2" />
                Start grading (no account needed)
              </Button>

              <Button
                variant="outline"
                size="lg"
                onClick={() => navigate('/samples')}
                className="w-full h-12"
              >
                <BookOpen className="w-5 h-5 mr-2" />
                Try Sample Grading
              </Button>

              <button
                type="button"
                onClick={() => navigate('/auth')}
                className="w-full text-sm text-muted-foreground hover:text-foreground hover:underline transition-colors"
              >
                Sign in with an account
              </button>
            </div>
          </div>
        </main>

        <footer className="py-[18px] text-center border-t border-border">
          <p className="text-[13px] text-[hsl(218,11%,65%)]">
            Built with teachers to reduce paperwork.
          </p>
        </footer>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <AppHeader onSignOut={handleSignOut} />

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 sm:px-12 pb-20 min-h-[calc(100vh-120px)] w-full">
        <div className="flex flex-col items-center justify-center text-center w-full max-w-md mx-auto animate-fade-in">
          {/* Logo */}
          <div className="mb-6">
            <BottorLogo size={88} className="mx-auto" />
          </div>

          {/* Title */}
          <h1 className="text-[32px] sm:text-[40px] font-bold mb-3 text-primary">
            Bottor Assist
          </h1>
          <p className="text-lg sm:text-xl text-secondary-foreground font-medium mb-1">
            Grade with your rubric.
          </p>
          <p className="text-lg sm:text-xl text-secondary-foreground font-medium mb-10">
            You review. You decide.
          </p>

          {/* Actions */}
          <div className="space-y-4 w-full max-w-[320px]">
            {/* [ROUTE: /grade] Primary action - Start Grading Session */}
            <Button
              variant="hero"
              size="xl"
              onClick={() => navigate('/grade')}
              className="w-full h-12"
            >
              <ClipboardList className="w-5 h-5 mr-2" />
              Start Grading Session
            </Button>

            {/* [FUTURE: Google Classroom Integration] */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="lg"
                  disabled
                  className="w-full opacity-60 cursor-not-allowed h-12"
                >
                  <Link2 className="w-5 h-5 mr-2" />
                  Connect Google Classroom
                  <span className="ml-2 text-xs bg-muted px-2 py-0.5 rounded">Coming Soon</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                <p>Import assignments directly from Google Classroom. Student names and submissions will sync automatically.</p>
              </TooltipContent>
            </Tooltip>

            {/* [ROUTE: /history] Tertiary action - View History */}
            <button
              onClick={handleHistoryClick}
              className="w-full text-sm text-muted-foreground hover:text-foreground hover:underline transition-colors"
            >
              View grading history
              {isGuest && (
                <span className="ml-1 text-xs">(requires account)</span>
              )}
            </button>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-[18px] text-center border-t border-border">
        <p className="text-[13px] text-[hsl(218,11%,65%)]">
          Built with teachers to reduce paperwork.
        </p>
      </footer>
    </div>
  );
}
