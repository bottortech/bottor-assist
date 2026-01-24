/**
 * =============================================================================
 * GRADE PAPERS PAGE (/grade)
 * =============================================================================
 * 
 * PURPOSE: Upload student work (PDF/image), provide rubric, and generate 
 * AI-powered draft grades with feedback.
 * 
 * OPTIMISTIC UI: Uses useFileUpload hook for immediate display with status chips,
 * thumbnails, background extraction with concurrency limiting, and progress bar.
 * =============================================================================
 */

import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useSavedRubrics } from '@/hooks/useSavedRubrics';
import { useFileUpload } from '@/hooks/useFileUpload';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
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
  FileSearch,
  ChevronDown,
  ChevronRight,
  Info,
  AlertTriangle,
  CheckCircle2,
  BookOpen,
  History,
} from 'lucide-react';
import { FileUploadList } from '@/components/FileUploadList';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

const SUBJECTS = [
  'Mathematics', 'English Language Arts', 'Science', 'Social Studies', 'History',
  'Geography', 'Art', 'Music', 'Foreign Language', 'Computer Science', 'Other',
];

const GRADES = [
  'Pre-K', 'Kindergarten', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5',
  'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12',
];

const ASSIGNMENT_TYPES = [
  { value: 'multiple_choice', label: 'Multiple Choice' },
  { value: 'constructed_response', label: 'Constructed Response' },
  { value: 'essay', label: 'Essay' },
];

const RUBRIC_KEYWORDS = [
  'rubric', 'criteria', 'points', 'total', 'score', 'each', 'x3', 'x2',
  'requirements', 'grading', 'evaluation', 'pts', 'point value', 'scoring',
  '/5', '/10', '/15', '/20', '/25', '/50', '/100',
];

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

type GradingMode = 'scoring' | 'feedback-only';

export default function GradePapers() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const studentFileInputRef = useRef<HTMLInputElement>(null);
  const assignmentFileInputRef = useRef<HTMLInputElement>(null);
  const answerKeyFileInputRef = useRef<HTMLInputElement>(null);

  const { rubrics: savedRubrics, saveRubric, markRubricAsUsed } = useSavedRubrics();

  // Optimistic file upload hooks
  const studentUpload = useFileUpload({ maxConcurrentExtractions: 2, maxDimension: 1600 });
  const assignmentUpload = useFileUpload({ maxConcurrentExtractions: 2, maxDimension: 1600 });
  const answerKeyUpload = useFileUpload({ maxConcurrentExtractions: 2, maxDimension: 1600 });

  const [form, setForm] = useState<GradePapersForm>({
    grade_level: '', subject: '', assignment_type: '', rubric: '', answer_key: '',
  });

  const [autoDetectSources, setAutoDetectSources] = useState(true);
  const [detectedSourceCount, setDetectedSourceCount] = useState(0);
  const [gradingMode, setGradingMode] = useState<GradingMode>('feedback-only');
  const [detectedRubricSource, setDetectedRubricSource] = useState('');
  const [showSaveRubricPrompt, setShowSaveRubricPrompt] = useState(false);
  const [rubricNameInput, setRubricNameInput] = useState('');
  const [savingRubric, setSavingRubric] = useState(false);
  const [showDetectedRubricSuggestion, setShowDetectedRubricSuggestion] = useState(false);
  const [detectedRubricContent, setDetectedRubricContent] = useState('');
  const [result, setResult] = useState<GradingResult | null>(null);
  const [grading, setGrading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [optionalContextOpen, setOptionalContextOpen] = useState(false);
  const [answerKeyOpen, setAnswerKeyOpen] = useState(false);

  const studentCombinedText = studentUpload.combinedText;
  const assignmentCombinedText = assignmentUpload.combinedText;
  const answerKeyCombinedText = answerKeyUpload.combinedText;

  const detectRubricInText = (text: string): boolean => {
    if (!text.trim()) return false;
    const lowerText = text.toLowerCase();
    const matches = RUBRIC_KEYWORDS.filter(k => lowerText.includes(k.toLowerCase()));
    return matches.length >= 2;
  };

  useEffect(() => {
    const hasRubric = form.rubric.trim() || detectRubricInText(assignmentCombinedText) || detectRubricInText(studentCombinedText);
    setGradingMode(hasRubric ? 'scoring' : 'feedback-only');
    if (form.rubric.trim()) setDetectedRubricSource('Rubric textbox');
    else if (detectRubricInText(assignmentCombinedText)) setDetectedRubricSource('Assignment documents');
    else if (detectRubricInText(studentCombinedText)) setDetectedRubricSource('Student work');
    else setDetectedRubricSource('');
  }, [form.rubric, assignmentCombinedText, studentCombinedText]);

  const updateForm = (field: keyof GradePapersForm, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleStudentFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      studentUpload.addFiles(e.target.files);
      setResult(null);
    }
    if (studentFileInputRef.current) studentFileInputRef.current.value = '';
  };

  const handleAssignmentFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) assignmentUpload.addFiles(e.target.files);
    if (assignmentFileInputRef.current) assignmentFileInputRef.current.value = '';
  };

  const handleAnswerKeyFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) answerKeyUpload.addFiles(e.target.files);
    if (answerKeyFileInputRef.current) answerKeyFileInputRef.current.value = '';
  };

  const handleGenerateGrade = async () => {
    if (!studentCombinedText.trim()) {
      toast({ title: 'No student work', description: 'Upload files or paste text.', variant: 'destructive' });
      return;
    }
    setGrading(true);
    try {
      const effectiveRubric = form.rubric || (detectRubricInText(assignmentCombinedText) ? assignmentCombinedText : '');
      const combinedAnswerKey = [form.answer_key, answerKeyCombinedText].filter(Boolean).join('\n\n');
      
      const { data, error } = await supabase.functions.invoke('grade-paper', {
        body: {
          student_work: studentCombinedText,
          grade_level: form.grade_level,
          subject: form.subject,
          assignment_type: form.assignment_type,
          rubric: effectiveRubric,
          answer_key: combinedAnswerKey || null,
          assignment_doc_text: assignmentCombinedText || null,
          grading_mode: gradingMode,
        },
      });
      if (error) throw error;
      setResult({
        score_suggestion: data.score_suggestion || 'N/A',
        strengths: data.strengths || 'Not provided',
        areas_for_improvement: data.areas_for_improvement || 'Not provided',
        feedback_paragraph: data.feedback_paragraph || 'Not provided',
      });
      toast({ title: 'Grade and feedback generated!' });
    } catch (error) {
      console.error('Grading error:', error);
      toast({ title: 'Error', description: 'Failed to generate grade.', variant: 'destructive' });
    } finally {
      setGrading(false);
    }
  };

  const updateResult = (field: keyof GradingResult, value: string) => {
    if (result) setResult(prev => prev ? { ...prev, [field]: value } : null);
  };

  const handleCopy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    toast({ title: `${label} copied!` });
    setTimeout(() => setCopied(null), 2000);
  };

  const handleSave = async () => {
    if (!user || !result) return;
    setSaving(true);
    try {
      const sessionData = {
        user_id: user.id,
        status: 'completed',
        title: `${form.subject || 'Assignment'} - Grading`,
        snippet: `Score: ${result.score_suggestion}`,
        summary_json: { ...result, input_type: 'grading', grading_mode: gradingMode },
        teacher_notes: JSON.stringify(form),
        transcript: studentCombinedText,
      };
      if (sessionId) {
        await supabase.from('sessions').update(sessionData).eq('id', sessionId);
      } else {
        const { data } = await supabase.from('sessions').insert(sessionData).select().single();
        if (data) setSessionId(data.id);
      }
      toast({ title: 'Saved successfully!' });
    } catch (error) {
      toast({ title: 'Save failed', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-bottor-gradient flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const isExtracting = studentUpload.isExtracting || assignmentUpload.isExtracting || answerKeyUpload.isExtracting;
  const canGenerate = studentUpload.hasReadyFiles && !isExtracting;

  return (
    <div className="min-h-screen bg-bottor-gradient">
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-sm border-b border-border p-4">
        <div className="max-w-2xl mx-auto flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/')} className="text-muted-foreground">
            <ArrowLeft className="w-4 h-4 mr-2" />Home
          </Button>
          <h1 className="text-xl font-bold text-foreground">Grade Papers</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Student Work Upload */}
        <Card className="border-2 border-primary/30 shadow-lg bg-primary/5">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg">Student Work (Required)</CardTitle>
              <CardDescription className="text-xs">Upload PDFs or images. Text will be extracted automatically.</CardDescription>
            </div>
            {studentUpload.files.length > 0 && (
              <Button variant="ghost" size="sm" onClick={studentUpload.clearAllFiles} className="text-muted-foreground hover:text-destructive">
                Clear all
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <input ref={studentFileInputRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif" onChange={handleStudentFileSelect} className="hidden" id="student-file-upload" />
              <label htmlFor="student-file-upload" className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-muted-foreground/25 rounded-lg cursor-pointer hover:border-primary/50 transition-colors bg-muted/20">
                <Upload className="w-6 h-6 text-muted-foreground mb-2" />
                <span className="text-sm text-muted-foreground">Click to upload PDFs or images</span>
                <span className="text-xs text-muted-foreground mt-1">Multiple files • Max 10MB each</span>
              </label>
            </div>

            {studentUpload.files.length > 0 && (
              <FileUploadList
                files={studentUpload.files}
                onRemove={studentUpload.removeFile}
                onRetry={studentUpload.retryExtraction}
                label="Uploaded Files"
                totalFiles={studentUpload.totalFiles}
                completedFiles={studentUpload.completedFiles}
                failedFiles={studentUpload.failedFiles}
                progress={studentUpload.progress}
                isExtracting={studentUpload.isExtracting}
              />
            )}

            <div className="space-y-2">
              <Label>Extracted Text (combined) {studentUpload.isExtracting && '(Extracting...)'}</Label>
              <Textarea
                placeholder="Text extracted from files will appear here..."
                value={studentCombinedText}
                onChange={(e) => studentUpload.setCombinedText(e.target.value)}
                rows={10}
                disabled={studentUpload.isExtracting}
                className="font-mono text-sm"
              />
            </div>
          </CardContent>
        </Card>

        {/* Rubric Section */}
        <Card className="border-2 border-primary/30 shadow-lg bg-primary/5">
          <CardHeader>
            <CardTitle className="text-lg">Rubric / Grading Criteria <span className="text-xs font-normal text-muted-foreground">Optional</span></CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              placeholder="Paste your rubric or grading criteria here..."
              value={form.rubric}
              onChange={(e) => updateForm('rubric', e.target.value)}
              rows={6}
            />
            {gradingMode === 'scoring' ? (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/10 border border-primary/30">
                <CheckCircle2 className="w-4 h-4 text-primary" />
                <span className="text-sm text-primary">Rubric detected — Scoring enabled</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/30">
                <Info className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">No rubric — feedback-only mode</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Generate Button */}
        <div className="sticky bottom-4 z-10 bg-background/95 backdrop-blur-sm p-4 -mx-4 rounded-lg shadow-lg border">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <Button onClick={handleGenerateGrade} disabled={!canGenerate || grading} className="w-full" size="lg">
                    {grading ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Sparkles className="w-5 h-5 mr-2" />}
                    Generate Draft Grade + Feedback
                  </Button>
                </div>
              </TooltipTrigger>
              {!canGenerate && isExtracting && (
                <TooltipContent><p>Waiting for text extraction to complete...</p></TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Results */}
        {result && (
          <div className="space-y-4 animate-fade-in">
            <Card className="border-0 shadow-md bg-primary/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex justify-between">Suggested Score
                  <Button variant="ghost" size="sm" onClick={() => handleCopy(result.score_suggestion, 'Score')}>
                    {copied === 'Score' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Input value={result.score_suggestion} onChange={(e) => updateResult('score_suggestion', e.target.value)} className="text-xl font-bold text-primary" />
              </CardContent>
            </Card>

            <Card className="border-0 shadow-md"><CardHeader className="pb-2"><CardTitle className="text-lg">Strengths</CardTitle></CardHeader>
              <CardContent><Textarea value={result.strengths} onChange={(e) => updateResult('strengths', e.target.value)} rows={3} /></CardContent>
            </Card>

            <Card className="border-0 shadow-md"><CardHeader className="pb-2"><CardTitle className="text-lg">Areas for Improvement</CardTitle></CardHeader>
              <CardContent><Textarea value={result.areas_for_improvement} onChange={(e) => updateResult('areas_for_improvement', e.target.value)} rows={3} /></CardContent>
            </Card>

            <Card className="border-0 shadow-md"><CardHeader className="pb-2"><CardTitle className="text-lg">Draft Feedback</CardTitle></CardHeader>
              <CardContent><Textarea value={result.feedback_paragraph} onChange={(e) => updateResult('feedback_paragraph', e.target.value)} rows={5} /></CardContent>
            </Card>

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => window.print()} className="flex-1"><Download className="w-4 h-4 mr-2" />Download PDF</Button>
              <Button onClick={handleSave} disabled={saving} className="flex-1">
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                {sessionId ? 'Update' : 'Save'}
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
