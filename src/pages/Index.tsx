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
import { LogOut, History, GraduationCap, UserCircle, Link2 } from 'lucide-react';

export default function Index() {
  const { user, loading, signOut } = useAuth();
  const { isGuest, exitGuestMode } = useGuestMode();
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
      <div className="min-h-screen bg-bottor-gradient flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Allow access for both authenticated users AND guests
  const hasAccess = user || isGuest;

  // If no access, show login prompt instead of redirecting
  if (!hasAccess) {
    return (
      <div className="min-h-screen bg-bottor-gradient flex flex-col">
        <main className="flex-1 flex flex-col items-center justify-center px-6 pb-20">
          <div className="text-center max-w-md mx-auto animate-fade-in">
            {/* Logo */}
            <div className="inline-flex items-center justify-center w-24 h-24 rounded-2xl bg-primary text-primary-foreground mb-6 shadow-xl shadow-primary/20">
              <GraduationCap className="w-12 h-12" />
            </div>

            {/* Title */}
            <h1 className="text-4xl font-bold mb-3 text-gradient-primary">
              Bottor Assist
            </h1>
            <p className="text-xl text-muted-foreground mb-2">
              Teach. I'll handle the notes.
            </p>
            <p className="text-sm text-muted-foreground/70 mb-10">
              Pilot Version — sample documents only.
            </p>

            {/* Actions */}
            <div className="space-y-4">
              <Button
                variant="hero"
                size="xl"
                onClick={() => navigate('/auth')}
                className="w-full"
              >
                <UserCircle className="w-5 h-5 mr-2" />
                Sign In or Continue as Guest
              </Button>
            </div>
          </div>
        </main>

        <footer className="p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Built with teachers to reduce paperwork.
          </p>
        </footer>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bottor-gradient flex flex-col">
      {/* Header */}
      <header className="p-4 flex justify-between items-center">
        {/* Guest Mode Badge */}
        {isGuest ? (
          <div className="flex flex-col items-start gap-0.5">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
              <UserCircle className="w-3.5 h-3.5" />
              Guest Mode
            </span>
            <span className="text-[10px] text-muted-foreground pl-3">
              No account required
            </span>
          </div>
        ) : (
          <div />
        )}
        
        <Button
          variant="ghost"
          size="sm"
          onClick={handleSignOut}
          className="text-muted-foreground"
        >
          <LogOut className="w-4 h-4 mr-2" />
          {isGuest ? 'Exit Guest Mode' : 'Sign Out'}
        </Button>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 pb-20">
        <div className="text-center max-w-md mx-auto animate-fade-in">
          {/* Logo */}
          <div className="inline-flex items-center justify-center w-24 h-24 rounded-2xl bg-primary text-primary-foreground mb-6 shadow-xl shadow-primary/20">
            <GraduationCap className="w-12 h-12" />
          </div>

          {/* Title */}
          <h1 className="text-4xl font-bold mb-3 text-gradient-primary">
            Bottor Assist
          </h1>
          <p className="text-xl text-muted-foreground mb-2">
            Teach. I'll handle the notes.
          </p>
          <p className="text-sm text-muted-foreground/70 mb-10">
            {isGuest ? 'Pilot Mode — sample documents only. Feedback welcome.' : 'Pilot Version — sample documents only.'}
          </p>

          {/* Actions */}
          <div className="space-y-4">
            {/* [ROUTE: /grade] Primary action - Grade Papers */}
            <Button
              variant="hero"
              size="xl"
              onClick={() => navigate('/grade')}
              className="w-full"
            >
              <GraduationCap className="w-5 h-5 mr-2" />
              Grade Papers (Batch Grading)
            </Button>

            {/* [FUTURE: Google Classroom Integration] */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="lg"
                  disabled
                  className="w-full opacity-60 cursor-not-allowed"
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
            <Button
              variant="subtle"
              size="lg"
              onClick={handleHistoryClick}
              className="w-full"
            >
              <History className="w-5 h-5 mr-2" />
              History
              {isGuest && (
                <span className="ml-2 text-xs text-muted-foreground">(requires account)</span>
              )}
            </Button>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Built with teachers to reduce paperwork.
        </p>
      </footer>
    </div>
  );
}
