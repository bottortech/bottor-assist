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
  Printer,
  Lock,
  Unlock,
  Link as LinkIcon,
  ExternalLink,
  Eye,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { FileUploadList } from '@/components/FileUploadList';
import { GradeReportPreview } from '@/components/GradeReportPreview';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { isPilotMode } from '@/lib/feature-flags';
import { generateGradeReportPdf, generatePdfFilename } from '@/lib/pdf-generator';

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
type RubricMode = 'none' | 'draft' | 'locked';

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
  const [rubricMode, setRubricMode] = useState<RubricMode>('none');
  const [rubricLocked, setRubricLocked] = useState(false);
  const [detectedRubricSource, setDetectedRubricSource] = useState('');
  const [showSaveRubricPrompt, setShowSaveRubricPrompt] = useState(false);
  const [rubricNameInput, setRubricNameInput] = useState('');
  const [savingRubric, setSavingRubric] = useState(false);
  const [showDetectedRubricSuggestion, setShowDetectedRubricSuggestion] = useState(false);
  const [detectedRubricContent, setDetectedRubricContent] = useState('');
  const [result, setResult] = useState<GradingResult | null>(null);
  const [grading, setGrading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [studentName, setStudentName] = useState('');
  const [assignmentName, setAssignmentName] = useState('');
  const [optionalContextOpen, setOptionalContextOpen] = useState(false);
  const [answerKeyOpen, setAnswerKeyOpen] = useState(false);
  const [savedPdfUrl, setSavedPdfUrl] = useState<string | null>(null);
  const [savedPdfFilename, setSavedPdfFilename] = useState<string | null>(null);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

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
    
    // Determine rubric mode based on detection and lock state
    if (!hasRubric) {
      setRubricMode('none');
    } else if (rubricLocked) {
      setRubricMode('locked');
    } else {
      setRubricMode('draft');
    }
    
    if (form.rubric.trim()) setDetectedRubricSource('Rubric textbox');
    else if (detectRubricInText(assignmentCombinedText)) setDetectedRubricSource('Assignment documents');
    else if (detectRubricInText(studentCombinedText)) setDetectedRubricSource('Student work');
    else setDetectedRubricSource('');
  }, [form.rubric, assignmentCombinedText, studentCombinedText, rubricLocked]);

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

  const handlePreviewReport = () => {
    if (!result) return;
    setPreviewOpen(true);
  };

  const handleDownloadPdf = async () => {
    if (!result || !user) return;
    
    // In pilot mode, just open preview instead
    if (isPilotMode()) {
      handlePreviewReport();
      return;
    }
    
    setDownloadingPdf(true);
    setUploadingPdf(true);
    
    try {
      // Call server-side PDF generation edge function
      const { data, error } = await supabase.functions.invoke('generate-pdf-report', {
        body: {
          studentName: studentName || 'Student',
          assignmentName: assignmentName || form.subject || 'Assignment',
          score: result.score_suggestion,
          strengths: result.strengths,
          areasForImprovement: result.areas_for_improvement,
          feedback: result.feedback_paragraph,
          gradingMode: gradingMode,
          subject: form.subject,
          gradeLevel: form.grade_level,
        },
      });

      if (error) throw error;

      if (!data?.success) {
        throw new Error(data?.details || 'PDF generation failed');
      }

      // Download the PDF from signed URL
      const response = await fetch(data.signedUrl);
      if (!response.ok) throw new Error('Failed to download PDF');
      
      const pdfBlob = await response.blob();
      const downloadUrl = URL.createObjectURL(pdfBlob);
      
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = data.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(downloadUrl);
      
      // Store URLs for re-download
      setSavedPdfUrl(data.publicUrl);
      setSavedPdfFilename(data.filename);
      
      toast({
        title: 'Saved to Reports',
        description: 'PDF has been generated and saved.',
      });
    } catch (error) {
      console.error('PDF generation error:', error);
      
      // Fallback to client-side generation
      try {
        const pdfBlob = generateGradeReportPdf({
          studentName: studentName || 'Student',
          assignmentName: assignmentName || form.subject || 'Assignment',
          score: result.score_suggestion,
          strengths: result.strengths,
          areasForImprovement: result.areas_for_improvement,
          feedback: result.feedback_paragraph,
          gradingMode: gradingMode,
          subject: form.subject,
          gradeLevel: form.grade_level,
        });
        
        const filename = generatePdfFilename(
          studentName || 'Student',
          assignmentName || form.subject || 'Assignment'
        );
        
        const downloadUrl = URL.createObjectURL(pdfBlob);
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(downloadUrl);
        
        toast({ title: 'PDF downloaded (local generation)' });
      } catch (fallbackError) {
        console.error('Fallback PDF error:', fallbackError);
        toast({ 
          title: 'PDF generation failed', 
          description: 'Please try again or use Print Report.', 
          variant: 'destructive' 
        });
      }
    } finally {
      setDownloadingPdf(false);
      setUploadingPdf(false);
    }
  };
  
  const handleDownloadAgain = () => {
    if (!savedPdfUrl || !savedPdfFilename) return;
    
    const link = document.createElement('a');
    link.href = savedPdfUrl;
    link.download = savedPdfFilename;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  
  const handleCopyLink = async () => {
    if (!savedPdfUrl) return;
    
    await navigator.clipboard.writeText(savedPdfUrl);
    setCopied('link');
    toast({ title: 'Link copied!' });
    setTimeout(() => setCopied(null), 2000);
  };

  const handlePrintReport = () => {
    if (!result) return;
    
    // Create a print-friendly HTML document
    const printContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Grade Report - ${studentName || 'Student'}</title>
        <style>
          @page { size: letter portrait; margin: 0.75in; }
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: 'Segoe UI', Tahoma, sans-serif; font-size: 11pt; line-height: 1.5; color: #1a1a1a; padding: 20px; }
          .header { text-align: center; border-bottom: 2px solid #2563eb; padding-bottom: 16px; margin-bottom: 24px; }
          .header h1 { font-size: 20pt; font-weight: 700; color: #1e40af; margin-bottom: 4px; }
          .header .subtitle { font-size: 10pt; color: #6b7280; }
          .meta-info { display: flex; flex-wrap: wrap; gap: 16px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; margin-bottom: 24px; }
          .meta-item { flex: 1; min-width: 120px; }
          .meta-label { font-size: 9pt; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px; }
          .meta-value { font-size: 11pt; font-weight: 600; color: #1a1a1a; }
          .section { margin-bottom: 20px; page-break-inside: avoid; }
          .section-title { font-size: 12pt; font-weight: 600; color: #1e40af; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-bottom: 10px; }
          .section-content { font-size: 11pt; line-height: 1.6; color: #374151; white-space: pre-wrap; }
          .score-box { background: linear-gradient(135deg, #dbeafe 0%, #eff6ff 100%); border: 2px solid #3b82f6; border-radius: 12px; padding: 16px 24px; text-align: center; margin-bottom: 24px; }
          .score-label { font-size: 10pt; color: #1e40af; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
          .score-value { font-size: 28pt; font-weight: 700; color: #1e40af; }
          .feedback-box { background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 16px; margin-top: 20px; }
          .feedback-box .section-title { color: #166534; border-bottom-color: #86efac; }
          .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 9pt; color: #9ca3af; }
          @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Grade Report</h1>
          <div class="subtitle">Generated on ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
        </div>
        <div class="meta-info">
          <div class="meta-item">
            <div class="meta-label">Student</div>
            <div class="meta-value">${studentName || 'Not specified'}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">Assignment</div>
            <div class="meta-value">${assignmentName || form.subject || 'Not specified'}</div>
          </div>
          ${form.subject ? `<div class="meta-item"><div class="meta-label">Subject</div><div class="meta-value">${form.subject}</div></div>` : ''}
          ${form.grade_level ? `<div class="meta-item"><div class="meta-label">Grade Level</div><div class="meta-value">${form.grade_level}</div></div>` : ''}
        </div>
        ${gradingMode === 'scoring' && result.score_suggestion !== 'N/A' ? `
          <div class="score-box">
            <div class="score-label">Suggested Score</div>
            <div class="score-value">${result.score_suggestion}</div>
          </div>
        ` : ''}
        <div class="section">
          <div class="section-title">Strengths</div>
          <div class="section-content">${result.strengths}</div>
        </div>
        <div class="section">
          <div class="section-title">Areas for Improvement</div>
          <div class="section-content">${result.areas_for_improvement}</div>
        </div>
        <div class="feedback-box">
          <div class="section">
            <div class="section-title">Draft Feedback</div>
            <div class="section-content">${result.feedback_paragraph}</div>
          </div>
        </div>
        <div class="footer">This report was generated using AI assistance. Please review before sharing.</div>
      </body>
      </html>
    `;
    
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(printContent);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => printWindow.print(), 300);
    }
  };

  const handleSave = async () => {
    if (!user || !result) return;
    setSaving(true);
    try {
      const sessionData = {
        user_id: user.id,
        status: 'completed',
        title: `${studentName || form.subject || 'Assignment'} - Grading`,
        snippet: `Score: ${result.score_suggestion}`,
        summary_json: { ...result, input_type: 'grading', grading_mode: gradingMode, studentName, assignmentName },
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
        <Card className={`border-2 shadow-lg ${
          rubricMode === 'locked' 
            ? 'border-green-500/50 bg-green-500/5' 
            : rubricMode === 'draft' 
              ? 'border-primary/30 bg-primary/5' 
              : 'border-muted bg-muted/10'
        }`}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">
                Rubric / Grading Criteria 
                <span className="text-xs font-normal text-muted-foreground ml-2">Optional</span>
              </CardTitle>
              {rubricMode !== 'none' && (
                <Badge 
                  variant={rubricMode === 'locked' ? 'default' : 'secondary'}
                  className={rubricMode === 'locked' ? 'bg-green-600 hover:bg-green-600' : ''}
                >
                  {rubricMode === 'locked' ? (
                    <><Lock className="w-3 h-3 mr-1" />Locked</>
                  ) : (
                    <><Unlock className="w-3 h-3 mr-1" />Draft</>
                  )}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              placeholder="Paste your rubric or grading criteria here..."
              value={form.rubric}
              onChange={(e) => updateForm('rubric', e.target.value)}
              rows={6}
              disabled={rubricMode === 'locked'}
              className={rubricMode === 'locked' ? 'opacity-75 bg-muted/20' : ''}
            />
            
            {/* Rubric Mode Status */}
            {rubricMode === 'none' && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/30 border border-muted">
                <Info className="w-4 h-4 text-muted-foreground" />
                <div className="flex-1">
                  <span className="text-sm text-muted-foreground">No rubric detected — Feedback-only mode</span>
                  <p className="text-xs text-muted-foreground/70 mt-0.5">
                    Paste a rubric above or upload assignment documents to enable scoring.
                  </p>
                </div>
              </div>
            )}
            
            {rubricMode === 'draft' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/10 border border-primary/30">
                  <CheckCircle2 className="w-4 h-4 text-primary" />
                  <div className="flex-1">
                    <span className="text-sm text-primary">Rubric detected — Scoring enabled</span>
                    {detectedRubricSource && (
                      <p className="text-xs text-primary/70 mt-0.5">
                        Source: {detectedRubricSource}
                      </p>
                    )}
                  </div>
                </div>
                
                {/* Lock Toggle */}
                <div className="flex items-center justify-between p-3 rounded-lg border border-muted bg-background">
                  <div className="flex items-center gap-2">
                    <Unlock className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <Label htmlFor="lock-rubric" className="text-sm font-medium cursor-pointer">
                        Lock rubric for auto-grading
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Hides manual options and uses rubric criteria only
                      </p>
                    </div>
                  </div>
                  <Switch
                    id="lock-rubric"
                    checked={rubricLocked}
                    onCheckedChange={setRubricLocked}
                  />
                </div>
              </div>
            )}
            
            {rubricMode === 'locked' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/30">
                  <Lock className="w-4 h-4 text-green-600" />
                  <div className="flex-1">
                    <span className="text-sm text-green-700 dark:text-green-400 font-medium">
                      Rubric locked — Auto-grading enabled
                    </span>
                    {detectedRubricSource && (
                      <p className="text-xs text-green-600/70 dark:text-green-400/70 mt-0.5">
                        Source: {detectedRubricSource}
                      </p>
                    )}
                  </div>
                </div>
                
                {/* Unlock Toggle */}
                <div className="flex items-center justify-between p-3 rounded-lg border border-green-500/30 bg-background">
                  <div className="flex items-center gap-2">
                    <Lock className="w-4 h-4 text-green-600" />
                    <div>
                      <Label htmlFor="lock-rubric" className="text-sm font-medium cursor-pointer">
                        Rubric locked for auto-grading
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Manual grading options are hidden
                      </p>
                    </div>
                  </div>
                  <Switch
                    id="lock-rubric"
                    checked={rubricLocked}
                    onCheckedChange={setRubricLocked}
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
        
        {/* Manual Grading Options - Hidden when rubric is locked */}
        {rubricMode !== 'locked' && (
          <Card className="border border-muted">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Info className="w-4 h-4" />
                Manual Grading Options
              </CardTitle>
              <CardDescription className="text-xs">
                These options are available when rubric is not locked
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Subject</Label>
                  <Select value={form.subject} onValueChange={(v) => updateForm('subject', v)}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Select subject" />
                    </SelectTrigger>
                    <SelectContent className="bg-background border shadow-lg z-50">
                      {SUBJECTS.map(s => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Grade Level</Label>
                  <Select value={form.grade_level} onValueChange={(v) => updateForm('grade_level', v)}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Select grade" />
                    </SelectTrigger>
                    <SelectContent className="bg-background border shadow-lg z-50">
                      {GRADES.map(g => (
                        <SelectItem key={g} value={g}>{g}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Assignment Type</Label>
                <Select value={form.assignment_type} onValueChange={(v) => updateForm('assignment_type', v)}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent className="bg-background border shadow-lg z-50">
                    {ASSIGNMENT_TYPES.map(t => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              {/* Answer Key - Only in manual mode */}
              <Collapsible open={answerKeyOpen} onOpenChange={setAnswerKeyOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full justify-between text-muted-foreground hover:text-foreground">
                    <span className="flex items-center gap-2">
                      <FileSearch className="w-4 h-4" />
                      Answer Key (Optional)
                    </span>
                    {answerKeyOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2 space-y-2">
                  <Textarea
                    placeholder="Paste answer key here..."
                    value={form.answer_key}
                    onChange={(e) => updateForm('answer_key', e.target.value)}
                    rows={4}
                    className="text-sm"
                  />
                </CollapsibleContent>
              </Collapsible>
            </CardContent>
          </Card>
        )}
        
        {/* Locked Mode Info */}
        {rubricMode === 'locked' && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/5 border border-green-500/20">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            <span className="text-sm text-green-700 dark:text-green-400">
              Auto-grading mode: Manual options hidden. Grading will use rubric criteria only.
            </span>
          </div>
        )}

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
            {/* PDF Export Info */}
            <Card className="border border-muted shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Report Details (for PDF export)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Student Name</Label>
                    <Input 
                      placeholder="Enter student name" 
                      value={studentName} 
                      onChange={(e) => setStudentName(e.target.value)}
                      className="h-9"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Assignment Name</Label>
                    <Input 
                      placeholder="Enter assignment name" 
                      value={assignmentName} 
                      onChange={(e) => setAssignmentName(e.target.value)}
                      className="h-9"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

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

            {/* Saved PDF Actions - Only show in non-pilot mode */}
            {!isPilotMode() && savedPdfUrl && (
              <Card className="border border-accent bg-accent/30">
                <CardContent className="py-3 flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-2 text-accent-foreground">
                    <CheckCircle2 className="w-5 h-5" />
                    <span className="font-medium text-sm">Saved to Reports</span>
                  </div>
                  <div className="flex gap-2">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={handleDownloadAgain}
                      className="gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download again
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={handleCopyLink}
                      className="gap-1.5"
                    >
                      {copied === 'link' ? (
                        <Check className="w-3.5 h-3.5" />
                      ) : (
                        <LinkIcon className="w-3.5 h-3.5" />
                      )}
                      Copy link
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      asChild
                    >
                      <a href={savedPdfUrl} target="_blank" rel="noopener noreferrer" className="gap-1.5">
                        <ExternalLink className="w-3.5 h-3.5" />
                        Open
                      </a>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Action Buttons - Pilot Mode */}
            {isPilotMode() ? (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-3">
                  <Button 
                    variant="default" 
                    onClick={handlePreviewReport}
                    className="flex-1 min-w-[160px]"
                  >
                    <Eye className="w-4 h-4 mr-2" />
                    Preview Grade Report
                  </Button>
                  <Button 
                    variant="outline" 
                    onClick={handlePrintReport}
                    className="min-w-[180px]"
                  >
                    <Printer className="w-4 h-4 mr-2" />
                    Print / Save (Pilot Mode)
                  </Button>
                  <Button onClick={handleSave} disabled={saving} className="flex-1 min-w-[100px]">
                    {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                    {sessionId ? 'Update' : 'Save'}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  Pilot mode: PDF downloads and saved reports will be available in the full release.
                </p>
              </div>
            ) : (
              /* Full Release Buttons */
              <div className="flex flex-wrap gap-3">
                <Button 
                  variant="outline" 
                  onClick={handleDownloadPdf} 
                  disabled={downloadingPdf || uploadingPdf}
                  className="flex-1 min-w-[140px]"
                >
                  {downloadingPdf ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : uploadingPdf ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4 mr-2" />
                      Download PDF
                    </>
                  )}
                </Button>
                <Button 
                  variant="ghost" 
                  onClick={handlePrintReport}
                  className="min-w-[120px]"
                >
                  <Printer className="w-4 h-4 mr-2" />
                  Print Report
                </Button>
                <Button onClick={handleSave} disabled={saving} className="flex-1 min-w-[100px]">
                  {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                  {sessionId ? 'Update' : 'Save'}
                </Button>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Grade Report Preview Modal */}
      {result && (
        <GradeReportPreview
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          data={{
            studentName: studentName || 'Test Subject',
            assignmentName: assignmentName || form.subject || 'Assignment',
            score: result.score_suggestion,
            strengths: result.strengths,
            areasForImprovement: result.areas_for_improvement,
            feedback: result.feedback_paragraph,
            gradingMode: gradingMode,
            subject: form.subject,
            gradeLevel: form.grade_level,
          }}
          onPrint={handlePrintReport}
        />
      )}
    </div>
  );
}
