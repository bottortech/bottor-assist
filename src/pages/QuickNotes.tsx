import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ArrowLeft,
  Sparkles,
  MessageSquare,
  Copy,
  Download,
  Save,
  Check,
  Loader2,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

const SUBJECTS = [
  'Mathematics',
  'English Language Arts',
  'Science',
  'Social Studies',
  'History',
  'Geography',
  'Art',
  'Music',
  'Physical Education',
  'Foreign Language',
  'Computer Science',
  'Other',
];

const GRADES = [
  'Pre-K',
  'Kindergarten',
  'Grade 1',
  'Grade 2',
  'Grade 3',
  'Grade 4',
  'Grade 5',
  'Grade 6',
  'Grade 7',
  'Grade 8',
  'Grade 9',
  'Grade 10',
  'Grade 11',
  'Grade 12',
];

interface QuickNotesForm {
  subject: string;
  grade: string;
  topic: string;
  whatWeDid: string;
  struggles: string;
  attentionNeeded: string;
  nextSteps: string;
}

interface GeneratedContent {
  summary: string | null;
  parentMessageWarm: string | null;
  parentMessageSms: string | null;
}

export default function QuickNotes() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [form, setForm] = useState<QuickNotesForm>({
    subject: '',
    grade: '',
    topic: '',
    whatWeDid: '',
    struggles: '',
    attentionNeeded: '',
    nextSteps: '',
  });

  const [generated, setGenerated] = useState<GeneratedContent>({
    summary: null,
    parentMessageWarm: null,
    parentMessageSms: null,
  });

  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const updateForm = (field: keyof QuickNotesForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleGenerateSummary = async () => {
    setLoadingSummary(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-quick-notes-summary', {
        body: { notes: form },
      });

      if (error) throw error;

      setGenerated((prev) => ({ ...prev, summary: data.summary }));
      toast({ title: 'Summary generated!' });
    } catch (error) {
      console.error('Error generating summary:', error);
      toast({
        title: 'Error',
        description: 'Failed to generate summary. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setLoadingSummary(false);
    }
  };

  const handleGenerateParentMessages = async () => {
    if (!generated.summary) {
      toast({
        title: 'Generate summary first',
        description: 'Please generate a summary before creating parent messages.',
        variant: 'destructive',
      });
      return;
    }

    setLoadingMessages(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-parent-messages', {
        body: { notes: form, summary: generated.summary },
      });

      if (error) throw error;

      setGenerated((prev) => ({
        ...prev,
        parentMessageWarm: data.warmMessage,
        parentMessageSms: data.smsMessage,
      }));
      toast({ title: 'Parent messages generated!' });
    } catch (error) {
      console.error('Error generating parent messages:', error);
      toast({
        title: 'Error',
        description: 'Failed to generate parent messages. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setLoadingMessages(false);
    }
  };

  const handleCopy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    toast({ title: `${label} copied to clipboard!` });
    setTimeout(() => setCopied(null), 2000);
  };

  const handleDownloadPDF = () => {
    const content = buildExportContent();
    
    // Create a printable HTML document
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast({
        title: 'Error',
        description: 'Please allow popups to download PDF.',
        variant: 'destructive',
      });
      return;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Lesson Summary - ${form.topic || 'Quick Notes'}</title>
          <style>
            body { font-family: system-ui, -apple-system, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; line-height: 1.6; }
            h1 { color: #0d9488; margin-bottom: 8px; }
            h2 { color: #374151; margin-top: 24px; margin-bottom: 8px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
            .meta { color: #6b7280; margin-bottom: 24px; }
            .section { margin-bottom: 16px; }
            .label { font-weight: 600; color: #374151; }
            .content { white-space: pre-wrap; }
            .message-box { background: #f3f4f6; padding: 16px; border-radius: 8px; margin-top: 8px; }
            @media print { body { padding: 20px; } }
          </style>
        </head>
        <body>
          ${content}
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  const buildExportContent = () => {
    const date = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    return `
      <h1>${form.topic || 'Lesson Summary'}</h1>
      <p class="meta">${form.subject || 'Not provided'} · ${form.grade || 'Not provided'} · ${date}</p>
      
      <h2>Lesson Notes</h2>
      <div class="section">
        <p class="label">What we did today:</p>
        <p class="content">${form.whatWeDid || 'Not provided.'}</p>
      </div>
      <div class="section">
        <p class="label">What students struggled with:</p>
        <p class="content">${form.struggles || 'Not provided.'}</p>
      </div>
      <div class="section">
        <p class="label">Students needing attention:</p>
        <p class="content">${form.attentionNeeded || 'Not provided.'}</p>
      </div>
      <div class="section">
        <p class="label">Homework/Next steps:</p>
        <p class="content">${form.nextSteps || 'Not provided.'}</p>
      </div>
      
      ${generated.summary ? `
        <h2>AI-Generated Summary</h2>
        <p class="content">${generated.summary}</p>
      ` : ''}
      
      ${generated.parentMessageWarm ? `
        <h2>Parent Message (Warm)</h2>
        <div class="message-box">${generated.parentMessageWarm}</div>
      ` : ''}
      
      ${generated.parentMessageSms ? `
        <h2>Parent Message (SMS-Ready)</h2>
        <div class="message-box">${generated.parentMessageSms}</div>
      ` : ''}
    `;
  };

  const handleSave = async () => {
    if (!user) return;

    setSaving(true);
    try {
      const summaryJson = {
        lesson_summary: generated.summary || 'Not provided.',
        student_understanding: {
          strengths: form.whatWeDid || 'Not provided.',
          challenges: form.struggles || 'Not provided.',
        },
        attention_flags: form.attentionNeeded
          ? form.attentionNeeded.split(',').map((s) => s.trim()).filter(Boolean)
          : [],
        next_steps: form.nextSteps || 'Not provided.',
      };

      const sessionData = {
        user_id: user.id,
        status: 'completed',
        title: form.topic || `${form.subject} - ${form.grade}` || 'Quick Notes Session',
        snippet: form.whatWeDid?.slice(0, 100) || generated.summary?.slice(0, 100) || 'Quick notes session',
        summary_json: summaryJson,
        teacher_notes: JSON.stringify(form),
        parent_message_draft: generated.parentMessageWarm || null,
      };

      if (sessionId) {
        // Update existing
        const { error } = await supabase
          .from('sessions')
          .update(sessionData)
          .eq('id', sessionId);
        if (error) throw error;
      } else {
        // Create new
        const { data, error } = await supabase
          .from('sessions')
          .insert(sessionData)
          .select()
          .single();
        if (error) throw error;
        setSessionId(data.id);
      }

      toast({ title: 'Session saved successfully!' });
    } catch (error) {
      console.error('Error saving session:', error);
      toast({
        title: 'Error',
        description: 'Failed to save session. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-bottor-gradient flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const hasNotes = form.whatWeDid || form.struggles || form.attentionNeeded || form.nextSteps;

  return (
    <div className="min-h-screen bg-bottor-gradient">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-sm border-b border-border p-4">
        <div className="max-w-2xl mx-auto flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/')}
            className="text-muted-foreground"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Home
          </Button>
          <h1 className="text-xl font-bold text-foreground">Quick Notes</h1>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Form Section */}
        <Card className="border-0 shadow-md bg-card-gradient">
          <CardHeader>
            <CardTitle className="text-lg">Lesson Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="subject">Subject</Label>
                <Select value={form.subject} onValueChange={(v) => updateForm('subject', v)}>
                  <SelectTrigger id="subject">
                    <SelectValue placeholder="Select subject" />
                  </SelectTrigger>
                  <SelectContent>
                    {SUBJECTS.map((subject) => (
                      <SelectItem key={subject} value={subject}>
                        {subject}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="grade">Grade</Label>
                <Select value={form.grade} onValueChange={(v) => updateForm('grade', v)}>
                  <SelectTrigger id="grade">
                    <SelectValue placeholder="Select grade" />
                  </SelectTrigger>
                  <SelectContent>
                    {GRADES.map((grade) => (
                      <SelectItem key={grade} value={grade}>
                        {grade}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="topic">Lesson Topic</Label>
              <Input
                id="topic"
                placeholder="e.g., Introduction to Fractions"
                value={form.topic}
                onChange={(e) => updateForm('topic', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="whatWeDid">What we did today</Label>
              <Textarea
                id="whatWeDid"
                placeholder="Describe the main activities and learning objectives covered..."
                value={form.whatWeDid}
                onChange={(e) => updateForm('whatWeDid', e.target.value)}
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="struggles">What students struggled with</Label>
              <Textarea
                id="struggles"
                placeholder="Note any challenging concepts or common difficulties..."
                value={form.struggles}
                onChange={(e) => updateForm('struggles', e.target.value)}
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="attentionNeeded">Names/groups needing attention</Label>
              <Textarea
                id="attentionNeeded"
                placeholder="e.g., Sarah (needs extra help with multiplication), Table 3 group..."
                value={form.attentionNeeded}
                onChange={(e) => updateForm('attentionNeeded', e.target.value)}
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="nextSteps">Homework/Assessment/Next steps</Label>
              <Textarea
                id="nextSteps"
                placeholder="Upcoming assignments, assessments, or follow-up activities..."
                value={form.nextSteps}
                onChange={(e) => updateForm('nextSteps', e.target.value)}
                rows={2}
              />
            </div>
          </CardContent>
        </Card>

        {/* Generate Actions */}
        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            onClick={handleGenerateSummary}
            disabled={!hasNotes || loadingSummary}
            className="flex-1"
            size="lg"
          >
            {loadingSummary ? (
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            ) : (
              <Sparkles className="w-5 h-5 mr-2" />
            )}
            Generate Summary
          </Button>
          <Button
            onClick={handleGenerateParentMessages}
            disabled={!generated.summary || loadingMessages}
            variant="secondary"
            className="flex-1"
            size="lg"
          >
            {loadingMessages ? (
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            ) : (
              <MessageSquare className="w-5 h-5 mr-2" />
            )}
            Generate Parent Message
          </Button>
        </div>

        {/* Generated Summary */}
        {generated.summary && (
          <Card className="border-0 shadow-md bg-card-gradient animate-fade-in">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-lg">AI Summary</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleCopy(generated.summary!, 'Summary')}
              >
                {copied === 'Summary' ? (
                  <Check className="w-4 h-4 text-primary" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </Button>
            </CardHeader>
            <CardContent>
              <p className="text-foreground whitespace-pre-wrap">{generated.summary}</p>
            </CardContent>
          </Card>
        )}

        {/* Generated Parent Messages */}
        {generated.parentMessageWarm && (
          <Card className="border-0 shadow-md bg-card-gradient animate-fade-in">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-lg">Parent Message (Warm & Supportive)</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleCopy(generated.parentMessageWarm!, 'Warm Message')}
              >
                {copied === 'Warm Message' ? (
                  <Check className="w-4 h-4 text-primary" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </Button>
            </CardHeader>
            <CardContent>
              <p className="text-foreground whitespace-pre-wrap">{generated.parentMessageWarm}</p>
            </CardContent>
          </Card>
        )}

        {generated.parentMessageSms && (
          <Card className="border-0 shadow-md bg-card-gradient animate-fade-in">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-lg">Parent Message (SMS-Ready)</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleCopy(generated.parentMessageSms!, 'SMS Message')}
              >
                {copied === 'SMS Message' ? (
                  <Check className="w-4 h-4 text-primary" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </Button>
            </CardHeader>
            <CardContent>
              <p className="text-foreground whitespace-pre-wrap">{generated.parentMessageSms}</p>
            </CardContent>
          </Card>
        )}

        {/* Export Actions */}
        {(generated.summary || hasNotes) && (
          <div className="flex flex-wrap gap-3 justify-center pb-8">
            <Button
              variant="outline"
              onClick={() =>
                handleCopy(
                  `${generated.summary || ''}\n\n${generated.parentMessageWarm || ''}`.trim(),
                  'All Content'
                )
              }
            >
              <Copy className="w-4 h-4 mr-2" />
              Copy All
            </Button>
            <Button variant="outline" onClick={handleDownloadPDF}>
              <Download className="w-4 h-4 mr-2" />
              Download PDF
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              {sessionId ? 'Update' : 'Save'}
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
