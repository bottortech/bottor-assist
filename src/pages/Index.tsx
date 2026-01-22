/**
 * =============================================================================
 * HOME PAGE (/)
 * =============================================================================
 * 
 * NEXT.JS MIGRATION: app/page.tsx
 * 
 * PURPOSE: Entry point with navigation to Grade Papers, Quick Notes, and History.
 * 
 * DATA FLOW:
 * 1. [NAVIGATE] Route to appropriate page based on action
 * 
 * This is the main hub for all user flows.
 * =============================================================================
 */

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { LogOut, FileText, History, GraduationCap } from 'lucide-react';

export default function Index() {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();

  // [AUTH GUARD] Redirect unauthenticated users
  useEffect(() => {
    if (!loading && !user) {
      navigate('/auth', { replace: true });
    }
  }, [user, loading, navigate]);

  // [AUTH] Sign out user
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
            <GraduationCap className="w-10 h-10" />
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
            {/* [ROUTE: /grade] Primary action - Grade Papers */}
            <Button
              variant="hero"
              size="xl"
              onClick={() => navigate('/grade')}
              className="w-full"
            >
              <GraduationCap className="w-5 h-5 mr-2" />
              Grade Papers (Recommended)
            </Button>

            {/* [ROUTE: /quick-notes] Secondary action - Quick Notes */}
            <Button
              variant="outline"
              size="lg"
              onClick={() => navigate('/quick-notes')}
              className="w-full"
            >
              <FileText className="w-5 h-5 mr-2" />
              Quick Notes
            </Button>

            {/* [ROUTE: /history] Tertiary action - View History */}
            <Button
              variant="subtle"
              size="lg"
              onClick={() => navigate('/history')}
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
