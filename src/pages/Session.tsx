/**
 * =============================================================================
 * SESSION DETAIL PAGE (/session/:sessionId)
 * =============================================================================
 * 
 * NEXT.JS MIGRATION: app/session/[sessionId]/page.tsx
 * 
 * PURPOSE: Display session details including transcript, summary, and parent messages.
 * 
 * DATA FLOW:
 * 1. [FETCH] Load session from database by ID
 * 2. [PARSE] Validate and parse summary_json
 * 3. [DISPLAY] Render transcript, summary sections, teacher notes
 * 4. [AI CALL] Generate parent message on demand
 * 5. [SAVE] Persist teacher notes and parent message
 * 
 * UI ONLY: This component handles display and form state.
 * AI calls go through edge functions via supabase.functions.invoke.
 * =============================================================================
 */

import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ArrowLeft, Save, MessageSquare, Copy, Check, Loader2, AlertTriangle, Lightbulb, Users, Flag, FileText } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { parseSummaryJson, type SummaryJson } from '@/types/session';

// [TYPE] Session data structure for this page
interface SessionData {
  id: string;
  title: string;
  created_at: string;
  duration_seconds: number | null;
  summary_json: SummaryJson | null;
  teacher_notes: string | null;
  parent_message_draft: string | null;  // Legacy field for parent_message_teacher
  transcript: string | null;            // Legacy field for transcript_text
}

export default function Session() {
  const { sessionId } = useParams();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [session, setSession] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [teacherNotes, setTeacherNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isGeneratingMessage, setIsGeneratingMessage] = useState(false);
  const [showParentMessage, setShowParentMessage] = useState(false);
  const [parentMessage, setParentMessage] = useState('');
  const [copied, setCopied] = useState(false);

  // [AUTH GUARD] Redirect unauthenticated users
  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth', { replace: true });
    }
    if (!sessionId) {
      navigate('/', { replace: true });
    }
  }, [user, authLoading, sessionId, navigate]);

  // [DATA FETCH] Load session on mount
  useEffect(() => {
    if (!sessionId || !user) return;

    const fetchSession = async () => {
      // [MIGRATION POINT: Session Detail Query]
      const { data, error } = await supabase
        .from('sessions')
        .select('*')
        .eq('id', sessionId)
        .single();

      if (error) {
        toast({
          title: 'Error',
          description: 'Failed to load session.',
          variant: 'destructive',
        });
        navigate('/history');
        return;
      }

      // [PARSE] Validate and parse summary_json using type-safe helper
      const summaryJson = parseSummaryJson(data.summary_json);

      setSession({ ...data, summary_json: summaryJson });
      setTeacherNotes(data.teacher_notes || '');
      setParentMessage(data.parent_message_draft || '');
      setLoading(false);
    };

    fetchSession();
  }, [sessionId, user, navigate, toast]);

  // [SAVE] Persist teacher notes
  const handleSave = async () => {
    if (!sessionId) return;
    setIsSaving(true);

    try {
      // [MIGRATION POINT: Teacher Notes Update]
      await supabase
        .from('sessions')
        .update({ teacher_notes: teacherNotes })
        .eq('id', sessionId);

      toast({
        title: 'Saved',
        description: 'Your notes have been saved.',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to save notes.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // [AI CALL] Generate parent message via edge function
  const handleGenerateParentMessage = async () => {
    if (!sessionId) return;
    setIsGeneratingMessage(true);

    try {
      // [MIGRATION POINT: AI Parent Message Generation]
      // In Next.js, replace with server action calling Lovable AI directly
      const { data, error } = await supabase.functions.invoke('generate-parent-message', {
        body: { sessionId }
      });

      if (error) throw error;

      setParentMessage(data.message);
      setShowParentMessage(true);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to generate message.',
        variant: 'destructive',
      });
    } finally {
      setIsGeneratingMessage(false);
    }
  };

  // [COPY] Copy parent message to clipboard
  const handleCopyMessage = async () => {
    await navigator.clipboard.writeText(parentMessage);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // [SAVE] Persist parent message
  const handleSaveMessage = async () => {
    if (!sessionId) return;

    try {
      // [MIGRATION POINT: Parent Message Update]
      await supabase
        .from('sessions')
        .update({ parent_message_draft: parentMessage })
        .eq('id', sessionId);

      toast({
        title: 'Saved',
        description: 'Parent message saved.',
      });
      setShowParentMessage(false);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to save message.',
        variant: 'destructive',
      });
    }
  };

  // [FORMAT] Date display
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-bottor-gradient flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!session?.summary_json) {
    return (
      <div className="min-h-screen bg-bottor-gradient flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">No summary available for this session.</p>
          <Button onClick={() => navigate('/history')}>View All Sessions</Button>
        </div>
      </div>
    );
  }

  const summary = session.summary_json;

  // [SAFE ACCESS] Validated arrays from parseSummaryJson
  const lessonSummary = summary.lesson_summary;
  const strengths = summary.student_understanding.strengths;
  const challenges = summary.student_understanding.challenges;
  const attentionFlags = summary.attention_flags;
  const nextSteps = summary.next_steps;

  // Check if this is a brief/empty recording
  const isBriefRecording = summary.brief_recording || lessonSummary.length === 0;

  return (
    <div className="min-h-screen bg-bottor-gradient">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-sm border-b border-border p-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/history')}
            className="text-muted-foreground"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            History
          </Button>
          <Button
            variant="subtle"
            size="sm"
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span className="ml-2 hidden sm:inline">Save</span>
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-2xl mx-auto px-4 py-6 pb-24 space-y-6">
        {/* Title & Date */}
        <div className="animate-fade-in">
          <h1 className="text-2xl font-bold text-foreground mb-1">
            {session.title || 'Lesson Summary'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {formatDate(session.created_at)}
            {session.duration_seconds && ` · ${Math.floor(session.duration_seconds / 60)} min`}
          </p>
        </div>

        {/* Transcript - shown first */}
        <Card className="animate-slide-up border-0 shadow-md bg-card-gradient" style={{ animationDelay: '0.1s' }}>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" />
              Transcript
            </CardTitle>
          </CardHeader>
          <CardContent>
            {session.transcript ? (
              <div className="bg-muted/50 rounded-lg p-4 max-h-64 overflow-y-auto">
                <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                  {session.transcript}
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-muted-foreground">
                <AlertTriangle className="w-4 h-4 text-warning" />
                <span className="text-sm italic">
                  {summary.brief_reason || 'No speech detected'}
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Lesson Summary */}
        <Card className="animate-slide-up border-0 shadow-md bg-card-gradient" style={{ animationDelay: '0.15s' }}>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Lightbulb className="w-5 h-5 text-primary" />
              Lesson Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            {lessonSummary.length > 0 ? (
              <ul className="space-y-2">
                {lessonSummary.map((point, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 shrink-0" />
                    <span className="text-foreground">{point}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                {summary.brief_reason || 'No summary available for this recording.'}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Student Understanding - only show if we have data */}
        {(strengths.length > 0 || challenges.length > 0) && (
          <Card className="animate-slide-up border-0 shadow-md bg-card-gradient" style={{ animationDelay: '0.25s' }}>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="w-5 h-5 text-primary" />
                Student Understanding
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {strengths.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-success mb-2">Strengths</h4>
                  <ul className="space-y-1">
                    {strengths.map((s, i) => (
                      <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                        <span className="text-success">✓</span>
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {challenges.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-warning mb-2">Challenges</h4>
                  <ul className="space-y-1">
                    {challenges.map((c, i) => (
                      <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                        <span className="text-warning">!</span>
                        {c}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Attention Flags */}
        {attentionFlags.length > 0 && (
          <Card className="animate-slide-up border-0 shadow-md bg-accent/5" style={{ animationDelay: '0.35s' }}>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Flag className="w-5 h-5 text-accent" />
                Attention Flags
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {attentionFlags.map((flag, i) => (
                  <li key={i} className="flex items-start gap-2 text-foreground">
                    <AlertTriangle className="w-4 h-4 text-accent mt-0.5 shrink-0" />
                    {flag}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Next Steps */}
        {nextSteps.length > 0 && (
          <Card className="animate-slide-up border-0 shadow-md bg-card-gradient" style={{ animationDelay: '0.45s' }}>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Suggested Next Steps</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {nextSteps.map((step, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="w-6 h-6 rounded-full bg-secondary text-secondary-foreground text-xs font-medium flex items-center justify-center shrink-0">
                      {i + 1}
                    </span>
                    <span className="text-foreground">{step}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Teacher Notes */}
        <Card className="animate-slide-up border-0 shadow-md bg-card-gradient" style={{ animationDelay: '0.55s' }}>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Your Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              placeholder="Add your own observations or notes about this lesson..."
              value={teacherNotes}
              onChange={(e) => setTeacherNotes(e.target.value)}
              className="min-h-[100px] resize-none"
            />
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="animate-slide-up pt-4" style={{ animationDelay: '0.65s' }}>
          <Button
            variant="hero"
            className="w-full"
            onClick={handleGenerateParentMessage}
            disabled={isGeneratingMessage}
          >
            {isGeneratingMessage ? (
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            ) : (
              <MessageSquare className="w-5 h-5 mr-2" />
            )}
            Generate Parent Message
          </Button>
        </div>
      </main>

      {/* Parent Message Modal */}
      <Dialog open={showParentMessage} onOpenChange={setShowParentMessage}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Parent Message</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Textarea
              value={parentMessage}
              onChange={(e) => setParentMessage(e.target.value)}
              className="min-h-[200px] resize-none"
            />
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={handleCopyMessage} className="w-full sm:w-auto">
              {copied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
              {copied ? 'Copied!' : 'Copy'}
            </Button>
            <Button onClick={handleSaveMessage} className="w-full sm:w-auto">
              <Save className="w-4 h-4 mr-2" />
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
