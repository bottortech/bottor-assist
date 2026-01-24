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

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
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
  Save,
  Loader2,
  FileText,
  Download,
  FlaskConical,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { isPilotMode } from '@/lib/feature-flags';
import jsPDF from 'jspdf';

// Template definitions - Teacher-aligned documentation formats
const TEMPLATES = {
  'parent-contact': {
    label: 'Parent Contact Log',
    content: `Parent Contact Log

Parent / Guardian Name: 
Student (optional): 
Date & Time: ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
Method of Contact: [ ] Call  [ ] Email  [ ] In-Person  [ ] Virtual

Reason for Contact:


Summary of Discussion:


Next Steps / Follow-Up Needed:

`,
  },
  'meeting-notes': {
    label: 'Meeting Notes (School Use)',
    content: `Meeting Notes (School Use)

Meeting Type: 
Date: ${new Date().toLocaleDateString()}
Participants: 

Purpose / Agenda:


Key Discussion Points:


Decisions Made:


Action Items:


Follow-Up Date: 

`,
  },
  'behavior-observation': {
    label: 'Behavior Observation / Incident Note',
    content: `Behavior Observation / Incident Note

Student (optional): 
Date & Time: ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
Location: 

Observed Behavior:


Context / Trigger (if known):


Response Taken:


Outcome:


Notes / Reflection:

`,
  },
  'lesson-reflection': {
    label: 'Lesson Reflection (Teacher Use)',
    content: `Lesson Reflection (Teacher Use)

Lesson / Topic: 
Grade Level: 
Date: ${new Date().toLocaleDateString()}

What worked well:


What didn't work as expected:


Student engagement notes:


Ideas for improvement next time:

`,
  },
};

/**
 * Generates a PDF from the note content
 */
function generateNotePdf(noteTitle: string, noteContent: string): Blob {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'letter',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  let yPosition = margin;

  // Header styling
  doc.setFillColor(245, 247, 250);
  doc.rect(0, 0, pageWidth, 45, 'F');

  // Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(30, 41, 59);
  doc.text(noteTitle, margin, yPosition + 10);

  // Date
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(100, 116, 139);
  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  doc.text(dateStr, margin, yPosition + 20);

  // Pilot badge
  if (isPilotMode()) {
    doc.setFillColor(254, 243, 199);
    doc.roundedRect(pageWidth - margin - 35, yPosition + 5, 35, 8, 2, 2, 'F');
    doc.setFontSize(8);
    doc.setTextColor(146, 64, 14);
    doc.text('Pilot Mode', pageWidth - margin - 32, yPosition + 10);
  }

  // Divider
  yPosition = 50;
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.5);
  doc.line(margin, yPosition, pageWidth - margin, yPosition);

  // Content
  yPosition += 10;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(51, 65, 85);

  const lines = doc.splitTextToSize(noteContent, contentWidth);
  const lineHeight = 6;

  for (const line of lines) {
    if (yPosition + lineHeight > pageHeight - margin) {
      doc.addPage();
      yPosition = margin;
    }
    doc.text(line, margin, yPosition);
    yPosition += lineHeight;
  }

  // Footer
  const footerY = pageHeight - 10;
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text(
    'Generated from Quick Notes • Pilot Version',
    pageWidth / 2,
    footerY,
    { align: 'center' }
  );

  return doc.output('blob');
}

/**
 * Generates a sanitized filename for the note download
 */
function generateNoteFilename(title: string): string {
  const sanitized = title
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 40);
  const date = new Date().toISOString().split('T')[0];
  return `QuickNote_${sanitized || 'Note'}_${date}.pdf`;
}

export default function QuickNotes() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);

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
    if (!user) {
      toast({
        title: 'Please sign in',
        description: 'You need to be signed in to save notes.',
        variant: 'destructive',
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

  const handleDownload = async () => {
    if (!notes.trim()) {
      toast({
        title: 'No notes to download',
        description: 'Please enter some notes before downloading.',
        variant: 'destructive',
      });
      return;
    }

    setDownloading(true);
    try {
      // Extract title from first line
      const firstLine = notes.split('\n')[0]?.trim() || 'Quick Note';
      const title = firstLine.length > 50 ? firstLine.slice(0, 50) + '...' : firstLine;

      const pdfBlob = generateNotePdf(title, notes);
      const filename = generateNoteFilename(title);

      // Trigger download
      const url = URL.createObjectURL(pdfBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast({ title: 'Note downloaded!' });
    } catch (error) {
      console.error('Error downloading note:', error);
      toast({
        title: 'Download failed',
        description: 'Could not generate the note file. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setDownloading(false);
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
          <div>
            <h1 className="text-xl font-bold text-foreground">Quick Notes</h1>
          </div>
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

        {/* Recording Section (Coming Soon) */}
        <Card className="border-0 shadow-md bg-card-gradient">
          <CardContent className="pt-6 space-y-4">
            <Label className="flex items-center gap-2">
              <Mic className="w-4 h-4" />
              Record Notes (Speech-to-Text)
            </Label>
            
            <Button
              disabled
              variant="secondary"
              size="lg"
              className="w-full opacity-60 cursor-not-allowed"
            >
              <Mic className="w-5 h-5 mr-2" />
              Record (Coming Soon)
            </Button>
            
            <p className="text-sm text-muted-foreground text-center">
              Recording is being finalized. For now, type notes or paste a transcript.
            </p>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="space-y-4 pb-8">
          <div className="flex flex-col sm:flex-row justify-center gap-3">
            {/* Primary: Save Note */}
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

            {/* Secondary: Download Note */}
            <Button
              onClick={handleDownload}
              disabled={downloading || !notes.trim()}
              variant="outline"
              size="lg"
              className="min-w-[160px]"
            >
              {downloading ? (
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              ) : (
                <Download className="w-5 h-5 mr-2" />
              )}
              Download Note
            </Button>
          </div>

          {/* Pilot Mode Helper Text */}
          {isPilotMode() && (
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <FlaskConical className="w-3.5 h-3.5" />
              <span>
                Pilot mode: Notes can be saved and downloaded locally. Cloud history and sharing will be available in the full release.
              </span>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
