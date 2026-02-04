/**
 * =============================================================================
 * HISTORY PAGE (/history)
 * =============================================================================
 * 
 * NEXT.JS MIGRATION: app/history/page.tsx
 * 
 * PURPOSE: Display list of all sessions with search/filter.
 * Requires authentication - guests are prompted to sign up.
 * 
 * DATA FLOW:
 * 1. [FETCH] Load sessions from database on mount
 * 2. [DISPLAY] Render session cards with status badges
 * 3. [NAVIGATE] Click session → /session/:id
 * =============================================================================
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useGuestMode } from '@/hooks/useGuestMode';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Search, Mic, ChevronRight, UserCircle, Lock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import type { SessionListItem, SessionStatus } from '@/types/session';

export default function History() {
  const { user, loading: authLoading } = useAuth();
  const { isGuest, exitGuestMode } = useGuestMode();
  const navigate = useNavigate();

  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // [DATA FETCH] Load sessions on mount (only for authenticated users)
  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    const fetchSessions = async () => {
      const { data, error } = await supabase
        .from('sessions')
        .select('id, title, snippet, created_at, duration_seconds, status')
        .in('status', ['completed', 'recording', 'processing'])
        .order('created_at', { ascending: false });

      if (!error && data) {
        setSessions(data.map(row => ({
          ...row,
          status: row.status as SessionStatus,
        })));
      }
      setLoading(false);
    };

    fetchSessions();
  }, [user]);

  // [FILTER] Client-side search
  const filteredSessions = sessions.filter(session => {
    const searchLower = search.toLowerCase();
    return (
      session.title?.toLowerCase().includes(searchLower) ||
      session.snippet?.toLowerCase().includes(searchLower)
    );
  });

  // [FORMAT] Relative date display
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return `Today at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    } else if (diffDays === 1) {
      return `Yesterday at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    } else if (diffDays < 7) {
      return date.toLocaleDateString('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit' });
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // Handle sign up for guests
  const handleSignUp = () => {
    if (isGuest) {
      exitGuestMode();
    }
    navigate('/auth');
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Guest or unauthenticated users see sign-up prompt
  if (isGuest || !user) {
    return (
      <div className="min-h-screen bg-background">
        {/* Header */}
        <header className="sticky top-0 z-10 bg-background border-b border-border p-4">
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/')}
                className="text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Home
              </Button>
            </div>
          </div>
        </header>

        {/* Sign Up Prompt */}
        <main className="max-w-md mx-auto px-12 py-16">
          <Card className="border border-border shadow-card animate-fade-in">
            <CardHeader className="text-center pb-4">
              <div className="w-16 h-16 rounded-full bg-tint flex items-center justify-center mx-auto mb-4">
                <Lock className="w-8 h-8 text-primary" />
              </div>
              <CardTitle className="text-xl">Save Your Grading History</CardTitle>
              <CardDescription className="text-base mt-2">
                Create a free account to save and revisit your grading sessions.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                variant="hero"
                className="w-full h-12"
                onClick={handleSignUp}
              >
                <UserCircle className="w-5 h-5 mr-2" />
                Create Free Account
              </Button>
              <p className="text-xs text-center text-muted-foreground">
                Your current session results will be saved after you sign up.
              </p>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-background border-b border-border p-4">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center gap-4 mb-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/')}
              className="text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Home
            </Button>
          </div>
          <h1 className="text-xl font-semibold text-foreground mb-3">Session History</h1>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search summaries..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-2xl mx-auto px-12 py-6">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredSessions.length === 0 ? (
          <div className="text-center py-16 animate-fade-in">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
              <Mic className="w-8 h-8 text-muted-foreground" />
            </div>
            <h2 className="text-lg font-semibold text-foreground mb-2">
              {search ? 'No results found' : 'No summaries yet'}
            </h2>
            <p className="text-muted-foreground mb-6">
              {search 
                ? 'Try a different search term' 
                : 'Record your first lesson to get started'}
            </p>
            {!search && (
              <Button onClick={() => navigate('/')}>
                Start Listening
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {filteredSessions.map((session, index) => (
              <Card
                key={session.id}
                className="border border-border shadow-card hover:shadow-md transition-shadow cursor-pointer animate-slide-up"
                style={{ animationDelay: `${index * 0.05}s` }}
                onClick={() => navigate(`/session/${session.id}`)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-medium text-foreground truncate">
                          {session.title || 'Untitled Lesson'}
                        </h3>
                        {session.status !== 'completed' && (
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            session.status === 'recording' 
                              ? 'bg-destructive/10 text-destructive' 
                              : 'bg-tint text-primary'
                          }`}>
                            {session.status === 'recording' ? 'Recording' : 'Processing'}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                        {session.snippet || 'No preview available'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(session.created_at)}
                        {session.duration_seconds && ` · ${Math.floor(session.duration_seconds / 60)} min`}
                      </p>
                    </div>
                    <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0 mt-1" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
