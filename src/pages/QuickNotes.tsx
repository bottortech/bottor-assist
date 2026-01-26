/**
 * =============================================================================
 * QUICK NOTES PAGE (/quick-notes)
 * =============================================================================
 * 
 * PURPOSE: Simple note-taking for teachers - parent contacts, meetings, reminders.
 * Designed to be fast, focused, and teacher-friendly.
 * 
 * FEATURES:
 * - Large text area for quick notes
 * - Template insertion for common note types
 * - Coming soon: Speech-to-text recording
 * - Save to history
 * =============================================================================
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useGuestMode } from '@/hooks/useGuestMode';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ArrowLeft,
  Mic,
  MicOff,
  Save,
  Loader2,
  FileText,
  AlertCircle,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

// Template definitions
const TEMPLATES = {
  'parent-contact': {
    label: 'Parent Contact Log',
    content: `Parent Contact Log
Date: ${new Date().toLocaleDateString()}
Student: 
Contact Method: (phone / email / in-person)
Reason for Contact:

Discussion Summary:

Follow-up Needed:
`,
  },
  'meeting-notes': {
    label: 'Meeting Notes',
    content: `Meeting Notes
Date: ${new Date().toLocaleDateString()}
Attendees:

Purpose:

Key Discussion Points:

Action Items:

Next Meeting:
`,
  },
  'behavior-incident': {
    label: 'Behavior / Incident Note',
    content: `Behavior / Incident Note
Date: ${new Date().toLocaleDateString()}
Student(s) Involved:
Location:
Time:

Description of Incident:

Actions Taken:

Parent Notified: (yes / no)
Admin Notified: (yes / no)

Follow-up Plan:
`,
  },
  'lesson-reflection': {
    label: 'Lesson Reflection',
    content: `Lesson Reflection
Date: ${new Date().toLocaleDateString()}
Subject/Topic:

What Went Well:

What Could Be Improved:

Students Who Excelled:

Students Needing Support:

Notes for Next Time:
`,
  },
};

export default function QuickNotes() {
  const { user, loading: authLoading } = useAuth();
  const { isGuest } = useGuestMode();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  // Speech recognition
  const {
    isSupported: speechSupported,
    isListening,
    status: speechStatus,
    liveCaption,
    fullTranscript,
    noSpeechWarning,
    start: startRecording,
    stop: stopRecording,
    reset: resetTranscript,
  } = useSpeechRecognition();
  
  const [micPermissionDenied, setMicPermissionDenied] = useState(false);

  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  
  // Append finalized transcript to notes
  useEffect(() => {
    if (fullTranscript) {
      setNotes(prev => {
        // Add space or newline if there's existing content
        if (prev.trim()) {
          return prev + ' ' + fullTranscript.trim();
        }
        return fullTranscript.trim();
      });
      // Reset transcript after appending
      resetTranscript();
    }
  }, [fullTranscript, resetTranscript]);

  const handleStartRecording = async () => {
    setMicPermissionDenied(false);
    
    try {
      // Request mic permission first
      await navigator.mediaDevices.getUserMedia({ audio: true });
      startRecording();
    } catch (err) {
      console.warn('[QuickNotes] Mic permission denied:', err);
      setMicPermissionDenied(true);
      toast({
        title: 'Microphone Access Needed',
        description: 'Please allow microphone access to use speech-to-text.',
      });
    }
  };

  const handleStopRecording = () => {
    stopRecording();
  };
  const handleTemplateSelect = (templateKey: string) => {
    const template = TEMPLATES[templateKey as keyof typeof TEMPLATES];
    if (template) {
      // If notes already exist, append template with a separator
      if (notes.trim()) {
        setNotes(notes + '\n\n---\n\n' + template.content);
      } else {
        setNotes(template.content);
      }
      toast({ title: `${template.label} template inserted` });
    }
  };

  const handleSave = async () => {
    // Prompt guests to sign up
    if (isGuest || !user) {
      toast({
        title: 'Account Required',
        description: 'Create a free account to save and revisit your notes.',
      });
      return;
    }

    if (!notes.trim()) {
      toast({
        title: 'No notes to save',
        description: 'Please enter some notes before saving.',
        variant: 'destructive',
      });
      return;
    }

    setSaving(true);
    try {
      // Extract a title from the first line or use default
      const firstLine = notes.split('\n')[0]?.trim() || 'Quick Note';
      const title = firstLine.length > 50 ? firstLine.slice(0, 50) + '...' : firstLine;
      
      // Create a snippet from the content
      const snippet = notes.slice(0, 150).replace(/\n/g, ' ').trim();

      const sessionData = {
        user_id: user.id,
        status: 'completed',
        title: title,
        snippet: snippet,
        teacher_notes: notes,
        summary_json: {
          note_type: 'quick_note',
          content: notes,
          created_via: 'quick_notes_page',
        },
      };

      if (sessionId) {
        // Update existing
        const { error } = await supabase
          .from('sessions')
          .update(sessionData)
          .eq('id', sessionId);
        if (error) throw error;
        toast({ title: 'Note updated!' });
      } else {
        // Create new
        const { data, error } = await supabase
          .from('sessions')
          .insert(sessionData)
          .select()
          .single();
        if (error) throw error;
        setSessionId(data.id);
        toast({ title: 'Note saved!' });
      }
    } catch (error) {
      console.error('Error saving note:', error);
      toast({
        title: 'Error',
        description: 'Failed to save note. Please try again.',
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

  return (
    <div className="min-h-screen bg-bottor-gradient">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-sm border-b border-border p-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/')}
              className="text-muted-foreground"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Home
            </Button>
            <div>
              <h1 className="text-xl font-bold text-foreground">Quick Notes</h1>
            </div>
          </div>
          {isGuest && (
            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
              Pilot Mode
            </span>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Page Description */}
        <div className="text-center space-y-2">
          <p className="text-muted-foreground">
            Capture notes fast. Save for later. Great for parent contacts, meetings, and reminders.
          </p>
        </div>

        {/* Notes Input Section */}
        <Card className="border-0 shadow-md bg-card-gradient">
          <CardContent className="pt-6 space-y-4">
            {/* Template Helper */}
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Insert a template (optional)
              </Label>
              <Select onValueChange={handleTemplateSelect}>
                <SelectTrigger className="w-full sm:w-64">
                  <SelectValue placeholder="Choose a template..." />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TEMPLATES).map(([key, template]) => (
                    <SelectItem key={key} value={key}>
                      {template.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Notes Text Area */}
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                placeholder="Type quick notes here… (parent contact, reminders, meeting notes, etc.)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={12}
                className="resize-y min-h-[200px]"
              />
            </div>
          </CardContent>
        </Card>

        {/* Recording Section */}
        <Card className="border-0 shadow-md bg-card-gradient">
          <CardContent className="pt-6 space-y-4">
            <Label className="flex items-center gap-2">
              <Mic className="w-4 h-4" />
              Record Notes (Speech-to-Text)
            </Label>
            
            {!speechSupported ? (
              // Browser doesn't support Speech Recognition
              <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/50 border border-border">
                <AlertCircle className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
                <p className="text-sm text-muted-foreground">
                  Speech-to-text isn't supported in this browser. Please type or paste a transcript.
                </p>
              </div>
            ) : micPermissionDenied ? (
              // Mic permission was denied
              <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/50 border border-border">
                <MicOff className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Microphone access was denied. To use speech-to-text, please enable microphone access in your browser settings.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleStartRecording}
                  >
                    Try Again
                  </Button>
                </div>
              </div>
            ) : isListening ? (
              // Currently recording
              <div className="space-y-4">
                <Button
                  onClick={handleStopRecording}
                  variant="destructive"
                  size="lg"
                  className="w-full"
                >
                  <MicOff className="w-5 h-5 mr-2" />
                  Stop Recording
                </Button>
                
                {/* Status indicator */}
                <div className="flex items-center justify-center gap-3 py-3">
                  <div className="relative">
                    <Mic className={`w-6 h-6 ${speechStatus === 'paused' ? 'text-amber-500' : 'text-destructive'}`} />
                    <span className={`absolute -top-1 -right-1 w-3 h-3 rounded-full animate-pulse ${
                      speechStatus === 'paused' ? 'bg-amber-500' : 'bg-destructive'
                    }`} />
                  </div>
                  <span className={`text-sm font-medium ${speechStatus === 'paused' ? 'text-amber-500' : 'text-destructive'}`}>
                    {speechStatus === 'paused' ? 'Paused (listening…)' : 'Listening…'}
                  </span>
                </div>
                
                {/* Live caption preview */}
                {liveCaption && (
                  <div className="p-3 rounded-lg bg-muted/50 border border-border">
                    <p className="text-sm text-muted-foreground italic">{liveCaption}</p>
                  </div>
                )}
                
                {/* No speech warning */}
                {noSpeechWarning && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-accent/50 border border-accent">
                    <AlertCircle className="w-4 h-4 text-accent-foreground shrink-0" />
                    <p className="text-sm text-accent-foreground">
                      We can't hear you — check your mic
                    </p>
                  </div>
                )}
              </div>
            ) : speechStatus === 'stopped-silence' ? (
              // Stopped due to silence
              <div className="space-y-3">
                <Button
                  onClick={handleStartRecording}
                  variant="secondary"
                  size="lg"
                  className="w-full"
                >
                  <Mic className="w-5 h-5 mr-2" />
                  Start Recording
                </Button>
                <p className="text-sm text-muted-foreground text-center">
                  Stopped (10s silence). Click to record again.
                </p>
              </div>
            ) : (
              // Ready to record
              <div className="space-y-3">
                <Button
                  onClick={handleStartRecording}
                  variant="secondary"
                  size="lg"
                  className="w-full"
                >
                  <Mic className="w-5 h-5 mr-2" />
                  Start Recording
                </Button>
                <p className="text-sm text-muted-foreground text-center">
                  Click to start speaking. Your words will appear in the notes above.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Save Action */}
        <div className="flex justify-center pb-8">
          <Button
            onClick={handleSave}
            disabled={saving || !notes.trim()}
            size="lg"
            className="min-w-[160px]"
          >
            {saving ? (
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            ) : (
              <Save className="w-5 h-5 mr-2" />
            )}
            {sessionId ? 'Update Note' : 'Save Note'}
          </Button>
        </div>
      </main>
    </div>
  );
}
