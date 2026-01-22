/**
 * =============================================================================
 * GRADE PAPERS PAGE (/grade)
 * =============================================================================
 * 
 * NEXT.JS MIGRATION: app/grade/page.tsx
 * 
 * PURPOSE: Upload student work (PDF/image), provide rubric, and generate 
 * AI-powered draft grades with feedback.
 * 
 * DATA FLOW:
 * 1. [INPUT] User fills assignment details + rubric + optional answer key
 * 2. [UPLOAD] User uploads student work (PDF or image)
 * 3. [EXTRACT] Edge function extracts text from file
 * 4. [AI CALL] Generate grade + feedback via edge function
 * 5. [EDIT] User can edit all outputs before saving
 * 6. [SAVE] Persist session with assignment data and feedback
 * 
 * FIELD MAPPING (form → database):
 * - grade_level → notes_json.grade_level
 * - subject → notes_json.subject
 * - assignment_type → notes_json.assignment_type
 * - rubric → notes_json.rubric
 * - answer_key → notes_json.answer_key
 * - extracted_text → transcript_text
 * - grading_result → summary_json
 * =============================================================================
 */

import { useState, useRef } from 'react';
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
  Copy,
  Download,
  Save,
  Check,
  Loader2,
  Upload,
  FileText,
  X,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

/**
 * =============================================================================
 * CONSTANTS
 * =============================================================================
 */

const SUBJECTS = [
  'Mathematics',
  'English Language Arts',
  'Science',
  'Social Studies',
  'History',
  'Geography',
  'Art',
  'Music',
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

const ASSIGNMENT_TYPES = [
  { value: 'multiple_choice', label: 'Multiple Choice' },
  { value: 'constructed_response', label: 'Constructed Response' },
  { value: 'essay', label: 'Essay' },
];

/**
 * =============================================================================
 * TYPES
 * =============================================================================
 */

interface GradePapersForm {
  grade_level: string;
  subject: string;
  assignment_type: string;
  rubric: string;
  answer_key: string;
}

interface GradingResult {
  score_suggestion: string;
  strengths: string;
  areas_for_improvement: string;
  feedback_paragraph: string;
}

/**
 * =============================================================================
 * COMPONENT
 * =============================================================================
 */

export default function GradePapers() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [form, setForm] = useState<GradePapersForm>({
    grade_level: '',
    subject: '',
    assignment_type: '',
    rubric: '',
    answer_key: '',
  });

  // File state
  const [file, setFile] = useState<File | null>(null);
  const [extractedText, setExtractedText] = useState<string>('');
  const [extracting, setExtracting] = useState(false);

  // Results state (editable)
  const [result, setResult] = useState<GradingResult | null>(null);
  const [grading, setGrading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  /**
   * [FORM UPDATE] Update form field
   */
  const updateForm = (field: keyof GradePapersForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  /**
   * [FILE UPLOAD] Handle file selection
   */
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    // Validate file type
    const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(selectedFile.type)) {
      toast({
        title: 'Invalid file type',
        description: 'Please upload a PDF or image file (JPEG, PNG, WebP).',
        variant: 'destructive',
      });
      return;
    }

    // Validate file size (max 10MB)
    if (selectedFile.size > 10 * 1024 * 1024) {
      toast({
        title: 'File too large',
        description: 'Please upload a file smaller than 10MB.',
        variant: 'destructive',
      });
      return;
    }

    setFile(selectedFile);
    setExtractedText('');
    setResult(null);

    // Auto-extract text
    await extractTextFromFile(selectedFile);
  };

  /**
   * [TEXT EXTRACTION] Extract text from uploaded file
   * 
   * [MIGRATION POINT: File Processing]
   * In Next.js, use server action with pdf-parse or Tesseract.js
   */
  const extractTextFromFile = async (fileToExtract: File) => {
    setExtracting(true);
    try {
      // Convert file to base64
      const base64 = await fileToBase64(fileToExtract);
      
      // [EDGE FUNCTION CALL] Extract text
      const { data, error } = await supabase.functions.invoke('extract-text', {
        body: {
          file_data: base64,
          file_type: fileToExtract.type,
          file_name: fileToExtract.name,
        },
      });

      if (error) throw error;

      if (data.text) {
        setExtractedText(data.text);
        toast({ title: 'Text extracted successfully!' });
      } else {
        toast({
          title: 'No text found',
          description: 'Could not extract text from the file. You can type it manually.',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Text extraction error:', error);
      toast({
        title: 'Extraction failed',
        description: 'Could not extract text. You can paste or type the content manually.',
        variant: 'destructive',
      });
    } finally {
      setExtracting(false);
    }
  };

  /**
   * Convert file to base64 string
   */
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Remove data URL prefix to get pure base64
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  /**
   * [REMOVE FILE] Clear uploaded file
   */
  const removeFile = () => {
    setFile(null);
    setExtractedText('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  /**
   * [AI GRADING] Generate grade and feedback
   * 
   * [MIGRATION POINT: AI Grading]
   * In Next.js, replace with server action calling Lovable AI gateway
   */
  const handleGenerateGrade = async () => {
    if (!extractedText.trim()) {
      toast({
        title: 'No student work',
        description: 'Please upload a file or paste the student work text.',
        variant: 'destructive',
      });
      return;
    }

    if (!form.rubric.trim()) {
      toast({
        title: 'Rubric required',
        description: 'Please provide a rubric for grading.',
        variant: 'destructive',
      });
      return;
    }

    setGrading(true);
    try {
      const { data, error } = await supabase.functions.invoke('grade-paper', {
        body: {
          student_work: extractedText,
          grade_level: form.grade_level,
          subject: form.subject,
          assignment_type: form.assignment_type,
          rubric: form.rubric,
          answer_key: form.answer_key || null,
        },
      });

      if (error) throw error;

      setResult({
        score_suggestion: data.score_suggestion || 'Not provided',
        strengths: data.strengths || 'Not provided',
        areas_for_improvement: data.areas_for_improvement || 'Not provided',
        feedback_paragraph: data.feedback_paragraph || 'Not provided',
      });

      toast({ title: 'Grade and feedback generated!' });
    } catch (error) {
      console.error('Grading error:', error);
      toast({
        title: 'Error',
        description: 'Failed to generate grade. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setGrading(false);
    }
  };

  /**
   * [RESULT UPDATE] Allow editing of AI-generated results
   */
  const updateResult = (field: keyof GradingResult, value: string) => {
    if (!result) return;
    setResult((prev) => prev ? { ...prev, [field]: value } : null);
  };

  /**
   * [COPY] Copy content to clipboard
   */
  const handleCopy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    toast({ title: `${label} copied to clipboard!` });
    setTimeout(() => setCopied(null), 2000);
  };

  /**
   * [DOWNLOAD PDF] Export as printable PDF
   */
  const handleDownloadPDF = () => {
    if (!result) return;

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
          <title>Grade Report - ${form.subject || 'Assignment'}</title>
          <style>
            body { font-family: system-ui, -apple-system, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; line-height: 1.6; }
            h1 { color: #0d9488; margin-bottom: 8px; }
            h2 { color: #374151; margin-top: 24px; margin-bottom: 8px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
            .meta { color: #6b7280; margin-bottom: 24px; }
            .section { margin-bottom: 16px; }
            .label { font-weight: 600; color: #374151; }
            .content { white-space: pre-wrap; }
            .score { font-size: 1.5em; font-weight: bold; color: #0d9488; background: #f0fdfa; padding: 16px; border-radius: 8px; margin: 16px 0; }
            .feedback-box { background: #f3f4f6; padding: 16px; border-radius: 8px; margin-top: 8px; }
            @media print { body { padding: 20px; } }
          </style>
        </head>
        <body>
          <h1>Grade Report</h1>
          <p class="meta">${form.subject || 'Not specified'} · ${form.grade_level || 'Not specified'} · ${form.assignment_type ? ASSIGNMENT_TYPES.find(t => t.value === form.assignment_type)?.label : 'Not specified'}</p>
          
          <div class="score">Score: ${result.score_suggestion}</div>
          
          <h2>Strengths</h2>
          <p class="content">${result.strengths}</p>
          
          <h2>Areas for Improvement</h2>
          <p class="content">${result.areas_for_improvement}</p>
          
          <h2>Feedback for Student</h2>
          <div class="feedback-box">${result.feedback_paragraph}</div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  /**
   * [SAVE] Save session to database
   * 
   * [MIGRATION POINT: Session Save]
   * In Next.js, replace with server action
   */
  const handleSave = async () => {
    if (!user || !result) return;

    setSaving(true);
    try {
      // Build summary_json structure
      const summaryJson = {
        score_suggestion: result.score_suggestion,
        strengths: [result.strengths],
        areas_for_improvement: [result.areas_for_improvement],
        feedback_paragraph: result.feedback_paragraph,
        input_type: 'grading',
      };

      // Build notes_json for assignment metadata
      const notesJson = {
        grade_level: form.grade_level,
        subject: form.subject,
        assignment_type: form.assignment_type,
        rubric: form.rubric,
        answer_key: form.answer_key,
      };

      const sessionData = {
        user_id: user.id,
        status: 'completed',
        title: `${form.subject || 'Assignment'} - ${form.assignment_type ? ASSIGNMENT_TYPES.find(t => t.value === form.assignment_type)?.label : 'Grading'}`,
        snippet: `Score: ${result.score_suggestion} | ${result.strengths.slice(0, 80)}...`,
        summary_json: summaryJson,
        teacher_notes: JSON.stringify(notesJson),
        transcript: extractedText, // Store extracted student work
      };

      if (sessionId) {
        const { error } = await supabase
          .from('sessions')
          .update(sessionData)
          .eq('id', sessionId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('sessions')
          .insert(sessionData)
          .select()
          .single();
        if (error) throw error;
        setSessionId(data.id);
      }

      toast({ title: 'Grading session saved successfully!' });
    } catch (error) {
      console.error('Save error:', error);
      toast({
        title: 'Error',
        description: 'Failed to save session. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  // Loading state
  if (authLoading) {
    return (
      <div className="min-h-screen bg-bottor-gradient flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const canGenerate = extractedText.trim() && form.rubric.trim();

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
          <h1 className="text-xl font-bold text-foreground">Grade Papers</h1>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Assignment Details */}
        <Card className="border-0 shadow-md bg-card-gradient">
          <CardHeader>
            <CardTitle className="text-lg">Assignment Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="grade_level">Grade Level</Label>
                <Select 
                  value={form.grade_level} 
                  onValueChange={(v) => updateForm('grade_level', v)}
                >
                  <SelectTrigger id="grade_level">
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

              <div className="space-y-2">
                <Label htmlFor="subject">Subject</Label>
                <Select 
                  value={form.subject} 
                  onValueChange={(v) => updateForm('subject', v)}
                >
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
            </div>

            <div className="space-y-2">
              <Label htmlFor="assignment_type">Assignment Type</Label>
              <Select 
                value={form.assignment_type} 
                onValueChange={(v) => updateForm('assignment_type', v)}
              >
                <SelectTrigger id="assignment_type">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {ASSIGNMENT_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="rubric">Rubric *</Label>
              <Textarea
                id="rubric"
                placeholder="Paste your grading rubric here. Include criteria, point values, and expectations..."
                value={form.rubric}
                onChange={(e) => updateForm('rubric', e.target.value)}
                rows={5}
                className="font-mono text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="answer_key">Answer Key (Optional)</Label>
              <Textarea
                id="answer_key"
                placeholder="Paste answer key or correct responses for reference..."
                value={form.answer_key}
                onChange={(e) => updateForm('answer_key', e.target.value)}
                rows={3}
                className="font-mono text-sm"
              />
            </div>
          </CardContent>
        </Card>

        {/* File Upload */}
        <Card className="border-0 shadow-md bg-card-gradient">
          <CardHeader>
            <CardTitle className="text-lg">Student Work</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Upload Zone */}
            <div className="relative">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,image/jpeg,image/png,image/webp"
                onChange={handleFileSelect}
                className="hidden"
                id="file-upload"
              />
              
              {!file ? (
                <label
                  htmlFor="file-upload"
                  className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-muted-foreground/25 rounded-lg cursor-pointer hover:border-primary/50 transition-colors bg-muted/20"
                >
                  <Upload className="w-8 h-8 text-muted-foreground mb-2" />
                  <span className="text-sm text-muted-foreground">
                    Click to upload PDF or image
                  </span>
                  <span className="text-xs text-muted-foreground mt-1">
                    Max 10MB
                  </span>
                </label>
              ) : (
                <div className="flex items-center gap-3 p-4 border border-border rounded-lg bg-muted/20">
                  <FileText className="w-8 h-8 text-primary" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {(file.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                  {extracting ? (
                    <Loader2 className="w-5 h-5 animate-spin text-primary" />
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={removeFile}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              )}
            </div>

            {/* Extracted/Manual Text */}
            <div className="space-y-2">
              <Label htmlFor="extracted_text">
                Extracted Text {extracting && '(Extracting...)'}
              </Label>
              <Textarea
                id="extracted_text"
                placeholder="Text extracted from file will appear here. You can also paste or type student work directly..."
                value={extractedText}
                onChange={(e) => setExtractedText(e.target.value)}
                rows={8}
                disabled={extracting}
                className="font-mono text-sm"
              />
            </div>
          </CardContent>
        </Card>

        {/* Generate Button */}
        <Button
          onClick={handleGenerateGrade}
          disabled={!canGenerate || grading}
          className="w-full"
          size="lg"
        >
          {grading ? (
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
          ) : (
            <Sparkles className="w-5 h-5 mr-2" />
          )}
          Generate Draft Grade + Feedback
        </Button>

        {/* Results (Editable) */}
        {result && (
          <div className="space-y-4 animate-fade-in">
            {/* Score */}
            <Card className="border-0 shadow-md bg-primary/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center justify-between">
                  Suggested Score
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCopy(result.score_suggestion, 'Score')}
                  >
                    {copied === 'Score' ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Input
                  value={result.score_suggestion}
                  onChange={(e) => updateResult('score_suggestion', e.target.value)}
                  className="text-xl font-bold text-primary border-primary/20"
                />
              </CardContent>
            </Card>

            {/* Strengths */}
            <Card className="border-0 shadow-md bg-card-gradient">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center justify-between">
                  Strengths
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCopy(result.strengths, 'Strengths')}
                  >
                    {copied === 'Strengths' ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={result.strengths}
                  onChange={(e) => updateResult('strengths', e.target.value)}
                  rows={3}
                />
              </CardContent>
            </Card>

            {/* Areas for Improvement */}
            <Card className="border-0 shadow-md bg-card-gradient">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center justify-between">
                  Areas for Improvement
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCopy(result.areas_for_improvement, 'Areas')}
                  >
                    {copied === 'Areas' ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={result.areas_for_improvement}
                  onChange={(e) => updateResult('areas_for_improvement', e.target.value)}
                  rows={3}
                />
              </CardContent>
            </Card>

            {/* Feedback Paragraph */}
            <Card className="border-0 shadow-md bg-card-gradient">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center justify-between">
                  Draft Feedback (Teacher Tone)
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCopy(result.feedback_paragraph, 'Feedback')}
                  >
                    {copied === 'Feedback' ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={result.feedback_paragraph}
                  onChange={(e) => updateResult('feedback_paragraph', e.target.value)}
                  rows={5}
                />
              </CardContent>
            </Card>

            {/* Export Actions */}
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                variant="outline"
                onClick={handleDownloadPDF}
                className="flex-1"
              >
                <Download className="w-4 h-4 mr-2" />
                Download PDF
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving}
                className="flex-1"
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Save className="w-4 h-4 mr-2" />
                )}
                {sessionId ? 'Update' : 'Save'}
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
