import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ArrowLeft, Save, MessageSquare, Copy, Check, Loader2, AlertTriangle, Lightbulb, Users, Flag } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface SummaryData {
  lesson_summary: string[];
  student_understanding: {
    strengths: string[];
    challenges: string[];
  };
  attention_flags: string[];
  next_steps: string[];
}

interface SessionData {
  id: string;
  title: string;
  created_at: string;
  duration_seconds: number | null;
  summary_json: SummaryData | null;
  teacher_notes: string | null;
  parent_message_draft: string | null;
}

export default function Summary() {
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

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth', { replace: true });
    }
    if (!sessionId) {
      navigate('/', { replace: true });
    }
  }, [user, authLoading, sessionId, navigate]);

  useEffect(() => {
    if (!sessionId || !user) return;

    const fetchSession = async () => {
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
        navigate('/summaries');
        return;
      }

      // Parse summary_json if needed
      const summaryJson = typeof data.summary_json === 'string' 
        ? JSON.parse(data.summary_json) 
        : data.summary_json;

      setSession({ ...data, summary_json: summaryJson as SummaryData });
      setTeacherNotes(data.teacher_notes || '');
      setParentMessage(data.parent_message_draft || '');
      setLoading(false);
    };

    fetchSession();
  }, [sessionId, user, navigate, toast]);

  const handleSave = async () => {
    if (!sessionId) return;
    setIsSaving(true);

    try {
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

  const handleGenerateParentMessage = async () => {
    if (!sessionId) return;
    setIsGeneratingMessage(true);

    try {
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

  const handleCopyMessage = async () => {
    await navigator.clipboard.writeText(parentMessage);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveMessage = async () => {
    if (!sessionId) return;

    try {
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
          <Button onClick={() => navigate('/summaries')}>View All Summaries</Button>
        </div>
      </div>
    );
  }

  const summary = session.summary_json;

  return (
    <div className="min-h-screen bg-bottor-gradient">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-sm border-b border-border p-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/summaries')}
            className="text-muted-foreground"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Summaries
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

        {/* Lesson Summary */}
        <Card className="animate-slide-up border-0 shadow-md bg-card-gradient" style={{ animationDelay: '0.1s' }}>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Lightbulb className="w-5 h-5 text-primary" />
              Lesson Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {summary.lesson_summary.map((point, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 shrink-0" />
                  <span className="text-foreground">{point}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* Student Understanding */}
        <Card className="animate-slide-up border-0 shadow-md bg-card-gradient" style={{ animationDelay: '0.2s' }}>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className="w-5 h-5 text-primary" />
              Student Understanding
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {summary.student_understanding.strengths.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-bottor-success mb-2">Strengths</h4>
                <ul className="space-y-1">
                  {summary.student_understanding.strengths.map((s, i) => (
                    <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                      <span className="text-bottor-success">✓</span>
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {summary.student_understanding.challenges.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-bottor-warning mb-2">Challenges</h4>
                <ul className="space-y-1">
                  {summary.student_understanding.challenges.map((c, i) => (
                    <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                      <span className="text-bottor-warning">!</span>
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Attention Flags */}
        {summary.attention_flags.length > 0 && (
          <Card className="animate-slide-up border-0 shadow-md bg-accent/5" style={{ animationDelay: '0.3s' }}>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Flag className="w-5 h-5 text-accent" />
                Attention Flags
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {summary.attention_flags.map((flag, i) => (
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
        {summary.next_steps.length > 0 && (
          <Card className="animate-slide-up border-0 shadow-md bg-card-gradient" style={{ animationDelay: '0.4s' }}>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Suggested Next Steps</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {summary.next_steps.map((step, i) => (
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
        <Card className="animate-slide-up border-0 shadow-md bg-card-gradient" style={{ animationDelay: '0.5s' }}>
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
        <div className="animate-slide-up pt-4" style={{ animationDelay: '0.6s' }}>
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
