/**
 * =============================================================================
 * GRADE PAPERS PAGE (/grade) - v2 Automatic Grouping
 * =============================================================================
 * 
 * PURPOSE: Upload student work (PDF/image), provide rubric, and generate 
 * AI-powered draft grades with feedback.
 * 
 * AUTOMATIC GROUPING: No manual "assign pages to students" step required.
 * Files are auto-grouped by detected student names from filenames or extracted text.
 * Each SubmissionGroup is graded independently - never combined across students.
 * =============================================================================
 */

import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useSavedRubrics } from '@/hooks/useSavedRubrics';
import { useFileUpload } from '@/hooks/useFileUpload';
import { useStudentSubmissions } from '@/hooks/useStudentSubmissions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
  CheckCircle2,
  Printer,
  Lock,
  Unlock,
  Eye,
  Users,
  Plus,
  AlertTriangle,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { FileUploadList } from '@/components/FileUploadList';
import { StudentSubmissionList } from '@/components/StudentSubmissionList';
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

interface SubmissionGradingResult {
  groupId: string;
  studentName: string;
  assignmentName?: string;
  result: GradingResult | null;
  grading: boolean;
  error?: string;
}

type GradingMode = 'scoring' | 'feedback-only';
type RubricMode = 'none' | 'draft' | 'locked';

export default function GradePapers() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const assignmentFileInputRef = useRef<HTMLInputElement>(null);
  const answerKeyFileInputRef = useRef<HTMLInputElement>(null);
  const rubricFileInputRef = useRef<HTMLInputElement>(null);

  const { rubrics: savedRubrics, saveRubric, markRubricAsUsed } = useSavedRubrics();

  // Student submissions hook (automatic grouping)
  const studentSubmissions = useStudentSubmissions({ maxConcurrentExtractions: 2 });
  
  // Other file upload hooks
  const assignmentUpload = useFileUpload({ maxConcurrentExtractions: 2 });
  const answerKeyUpload = useFileUpload({ maxConcurrentExtractions: 2 });
  const rubricUpload = useFileUpload({ maxConcurrentExtractions: 2 });

  const [form, setForm] = useState<GradePapersForm>({
    grade_level: '', subject: '', assignment_type: '', rubric: '', answer_key: '',
  });

  const [gradingMode, setGradingMode] = useState<GradingMode>('feedback-only');
  const [rubricMode, setRubricMode] = useState<RubricMode>('none');
  const [rubricLocked, setRubricLocked] = useState(false);
  const [detectedRubricSource, setDetectedRubricSource] = useState('');
  
  // Per-group grading results
  const [submissionResults, setSubmissionResults] = useState<SubmissionGradingResult[]>([]);
  const [activeSubmissionIndex, setActiveSubmissionIndex] = useState(0);
  
  const [grading, setGrading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [assignmentName, setAssignmentName] = useState('');
  const [answerKeyOpen, setAnswerKeyOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const assignmentCombinedText = assignmentUpload.combinedText ?? '';
  const answerKeyCombinedText = answerKeyUpload.combinedText ?? '';
  const rubricCombinedText = rubricUpload.combinedText ?? '';

  // Get combined text from all groups for rubric detection
  const allGroupsCombinedText = studentSubmissions.groups.map(g => g.combinedText).join('\n\n');

  const detectRubricInText = (text: string): boolean => {
    if (!text.trim()) return false;
    const lowerText = text.toLowerCase();
    const matches = RUBRIC_KEYWORDS.filter(k => lowerText.includes(k.toLowerCase()));
    return matches.length >= 2;
  };

  useEffect(() => {
    const hasUploadedRubric = rubricCombinedText.trim().length > 0;
    const hasPastedRubric = form.rubric.trim().length > 0;
    const hasAssignmentRubric = detectRubricInText(assignmentCombinedText);
    const hasStudentRubric = detectRubricInText(allGroupsCombinedText);
    const hasRubric = hasUploadedRubric || hasPastedRubric || hasAssignmentRubric || hasStudentRubric;
    
    setGradingMode(hasRubric ? 'scoring' : 'feedback-only');
    
    if (!hasRubric) {
      setRubricMode('none');
    } else if (rubricLocked) {
      setRubricMode('locked');
    } else {
      setRubricMode('draft');
    }
    
    if (hasUploadedRubric) setDetectedRubricSource('Uploaded rubric document');
    else if (hasPastedRubric) setDetectedRubricSource('Rubric textbox');
    else if (hasAssignmentRubric) setDetectedRubricSource('Assignment documents');
    else if (hasStudentRubric) setDetectedRubricSource('Student work');
    else setDetectedRubricSource('');
  }, [form.rubric, assignmentCombinedText, allGroupsCombinedText, rubricLocked, rubricCombinedText]);

  // Auto-fill assignment name from first group's assignmentId
  useEffect(() => {
    const firstGroup = studentSubmissions.groups[0];
    if (firstGroup?.assignmentId && firstGroup.assignmentId !== 'default' && !assignmentName) {
      setAssignmentName(firstGroup.assignmentId);
    }
  }, [studentSubmissions.groups, assignmentName]);

  const updateForm = (field: keyof GradePapersForm, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      studentSubmissions.addFiles(Array.from(e.target.files));
      setSubmissionResults([]);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleAssignmentFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) assignmentUpload.addFiles(Array.from(e.target.files));
    if (assignmentFileInputRef.current) assignmentFileInputRef.current.value = '';
  };

  const handleAnswerKeyFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) answerKeyUpload.addFiles(Array.from(e.target.files));
    if (answerKeyFileInputRef.current) answerKeyFileInputRef.current.value = '';
  };

  const handleRubricFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) rubricUpload.addFiles(Array.from(e.target.files));
    if (rubricFileInputRef.current) rubricFileInputRef.current.value = '';
  };

  // Grade all groups separately
  const handleGenerateGrades = async () => {
    // Check for multiple students warning
    if (studentSubmissions.multipleStudentsWarning) {
      toast({ 
        title: 'Multiple students detected', 
        description: studentSubmissions.multipleStudentsWarning, 
        variant: 'destructive' 
      });
      return;
    }

    if (!studentSubmissions.canGrade) {
      if (studentSubmissions.isExtracting) {
        toast({ 
          title: 'Still processing', 
          description: 'Wait for file extraction to complete.', 
          variant: 'destructive' 
        });
      } else if (!studentSubmissions.hasReadyGroups) {
        toast({ 
          title: 'No ready submissions', 
          description: 'Wait for file extraction to complete.', 
          variant: 'destructive' 
        });
      }
      return;
    }

    const readyGroups = studentSubmissions.groups.filter(g => 
      g.pages.some(p => p.status === 'ready')
    );

    if (readyGroups.length === 0) {
      toast({ title: 'No ready submissions', description: 'Wait for file extraction to complete.', variant: 'destructive' });
      return;
    }

    setGrading(true);
    
    // Initialize results for all groups
    const initialResults: SubmissionGradingResult[] = readyGroups.map(group => ({
      groupId: group.groupId,
      studentName: group.studentName,
      assignmentName: group.assignmentId !== 'default' ? group.assignmentId : undefined,
      result: null,
      grading: true,
    }));
    setSubmissionResults(initialResults);

    const combinedRubric = [rubricCombinedText, form.rubric].filter(Boolean).join('\n\n');
    const effectiveRubric = combinedRubric || (detectRubricInText(assignmentCombinedText) ? assignmentCombinedText : '');
    const combinedAnswerKey = [answerKeyCombinedText, form.answer_key].filter(Boolean).join('\n\n');

    // Grade each group separately
    for (const group of readyGroups) {
      try {
        const { data, error } = await supabase.functions.invoke('grade-paper', {
          body: {
            student_work: group.combinedText,
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

        setSubmissionResults(prev => prev.map(r => 
          r.groupId === group.groupId ? {
            ...r,
            grading: false,
            result: {
              score_suggestion: data.score_suggestion || 'N/A',
              strengths: data.strengths || 'Not provided',
              areas_for_improvement: data.areas_for_improvement || 'Not provided',
              feedback_paragraph: data.feedback_paragraph || 'Not provided',
            }
          } : r
        ));
      } catch (error) {
        console.error('Grading error for', group.studentName, error);
        setSubmissionResults(prev => prev.map(r => 
          r.groupId === group.groupId ? {
            ...r,
            grading: false,
            error: 'Grading failed'
          } : r
        ));
      }
    }

    setGrading(false);
    toast({ title: `Graded ${readyGroups.length} submission(s)!` });
  };

  const activeResult = submissionResults[activeSubmissionIndex];

  const updateActiveResult = (field: keyof GradingResult, value: string) => {
    setSubmissionResults(prev => prev.map((r, idx) => 
      idx === activeSubmissionIndex && r.result ? {
        ...r,
        result: { ...r.result, [field]: value }
      } : r
    ));
  };

  const handleCopy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    toast({ title: `${label} copied!` });
    setTimeout(() => setCopied(null), 2000);
  };

  const handlePreviewReport = () => {
    if (!activeResult?.result) return;
    setPreviewOpen(true);
  };

  const handlePrintReport = () => {
    if (!activeResult?.result) return;
    const result = activeResult.result;
    const studentName = activeResult.studentName;
    
    const printContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Grade Report - ${studentName}</title>
        <style>
          @page { size: letter portrait; margin: 0.75in; }
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: 'Segoe UI', Tahoma, sans-serif; font-size: 11pt; line-height: 1.5; color: #1a1a1a; padding: 20px; }
          .header { text-align: center; border-bottom: 2px solid #2563eb; padding-bottom: 16px; margin-bottom: 24px; }
          .header h1 { font-size: 20pt; font-weight: 700; color: #1e40af; margin-bottom: 4px; }
          .section { margin-bottom: 20px; }
          .section-title { font-size: 12pt; font-weight: 600; color: #1e40af; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-bottom: 10px; }
          .section-content { font-size: 11pt; line-height: 1.6; color: #374151; white-space: pre-wrap; }
          .score-box { background: #dbeafe; border: 2px solid #3b82f6; border-radius: 12px; padding: 16px; text-align: center; margin-bottom: 24px; }
          .score-value { font-size: 28pt; font-weight: 700; color: #1e40af; }
        </style>
      </head>
      <body>
        <div class="header"><h1>Grade Report - ${studentName}</h1></div>
        ${gradingMode === 'scoring' ? `<div class="score-box"><div class="score-value">${result.score_suggestion}</div></div>` : ''}
        <div class="section"><div class="section-title">Strengths</div><div class="section-content">${result.strengths}</div></div>
        <div class="section"><div class="section-title">Areas for Growth</div><div class="section-content">${result.areas_for_improvement}</div></div>
        <div class="section"><div class="section-title">Feedback</div><div class="section-content">${result.feedback_paragraph}</div></div>
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

  if (authLoading) {
    return (
      <div className="min-h-screen bg-bottor-gradient flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const hasAnyFiles = studentSubmissions.totalPages > 0;
  const isExtracting = studentSubmissions.isExtracting || assignmentUpload.isProcessing || answerKeyUpload.isProcessing;
  
  // Grading is enabled when all files are processed and we have ready groups
  const canGenerate = studentSubmissions.canGrade && !studentSubmissions.multipleStudentsWarning;
  const gradingBlockedReason = !hasAnyFiles 
    ? 'Upload student work first'
    : studentSubmissions.isExtracting 
      ? 'Waiting for text extraction...'
      : studentSubmissions.totalPendingPages > 0
        ? 'Processing files...'
        : !studentSubmissions.hasReadyGroups 
          ? 'No ready submissions'
          : studentSubmissions.multipleStudentsWarning
            ? 'Resolve student grouping first'
            : null;

  return (
    <div className="min-h-screen bg-bottor-gradient">
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-sm border-b border-border p-4">
        <div className="max-w-2xl mx-auto flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/')} className="text-muted-foreground">
            <ArrowLeft className="w-4 h-4 mr-2" />Home
          </Button>
          <h1 className="text-xl font-bold text-foreground">Grade Papers</h1>
          <Badge variant="outline" className="ml-auto text-xs">Pilot Mode</Badge>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Step 1: Upload Student Work */}
        <Card className="border-2 border-primary/30 shadow-lg bg-primary/5">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm font-bold">1</span>
                Upload Student Work
                <Badge variant="destructive" className="text-xs ml-2">Required</Badge>
              </CardTitle>
              <CardDescription className="text-xs mt-1">
                Upload PDFs or images. Students are auto-detected and grouped.
              </CardDescription>
            </div>
            {hasAnyFiles && (
              <Button variant="ghost" size="sm" onClick={studentSubmissions.clearAll} className="text-muted-foreground hover:text-destructive">
                Clear all
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {/* File Upload Area */}
            <div className="relative">
              <input 
                ref={fileInputRef} 
                type="file" 
                multiple 
                accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif" 
                onChange={handleFileSelect} 
                className="hidden" 
                id="student-work-upload" 
              />
              <label 
                htmlFor="student-work-upload" 
                className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-muted-foreground/25 rounded-lg cursor-pointer hover:border-primary/50 transition-colors bg-muted/20"
              >
                <Upload className="w-6 h-6 text-muted-foreground mb-2" />
                <span className="text-sm text-muted-foreground font-medium">Upload Student Pages</span>
                <span className="text-xs text-muted-foreground mt-1">PDF, JPG, PNG, HEIC (max 10MB each)</span>
              </label>
            </div>

            {/* Student Submission List */}
            {hasAnyFiles && (
              <StudentSubmissionList
                pendingPages={studentSubmissions.pendingPages}
                groups={studentSubmissions.groups}
                onRemovePendingPage={studentSubmissions.removePendingPage}
                onRetryPendingExtraction={studentSubmissions.retryPendingExtraction}
                onRenameStudent={studentSubmissions.renameStudent}
                onRemovePage={studentSubmissions.removePage}
                onDeleteGroup={studentSubmissions.deleteGroup}
                onRetryExtraction={studentSubmissions.retryExtraction}
                isExtracting={studentSubmissions.isExtracting}
                progress={studentSubmissions.progress}
                needsReviewCount={studentSubmissions.needsReviewCount}
                multipleStudentsWarning={studentSubmissions.multipleStudentsWarning}
              />
            )}
          </CardContent>
        </Card>

        {/* Step 2: Rubric Section */}
        <Card className={`border-2 shadow-lg ${
          rubricMode === 'locked' 
            ? 'border-green-500/50 bg-green-500/5' 
            : rubricMode === 'draft' 
              ? 'border-primary/30 bg-primary/5' 
              : 'border-muted bg-muted/10'
        }`}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-muted text-muted-foreground text-sm font-bold">2</span>
                Rubric / Grading Criteria 
                <span className="text-xs font-normal text-muted-foreground ml-2">Optional</span>
              </CardTitle>
              {rubricMode !== 'none' && (
                <Badge variant={rubricMode === 'locked' ? 'default' : 'secondary'}>
                  {rubricMode === 'locked' ? <><Lock className="w-3 h-3 mr-1" />Locked</> : <><Unlock className="w-3 h-3 mr-1" />Draft</>}
                </Badge>
              )}
            </div>
            <CardDescription className="text-xs">Upload or paste rubric — applies to all submissions.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <input ref={rubricFileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif" multiple className="hidden" onChange={handleRubricFileSelect} disabled={rubricMode === 'locked'} />
            <div className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${rubricMode === 'locked' ? 'border-muted bg-muted/20 cursor-not-allowed opacity-60' : 'border-muted hover:border-primary hover:bg-primary/5'}`} onClick={() => rubricMode !== 'locked' && rubricFileInputRef.current?.click()}>
              <Upload className="w-6 h-6 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Click to upload rubric files</p>
            </div>
            
            {rubricUpload.files.length > 0 && (
              <FileUploadList files={rubricUpload.files} onRemove={rubricUpload.removeFile} onRetry={rubricUpload.retryExtraction} />
            )}
            
            <Textarea placeholder="Or paste rubric text..." value={form.rubric} onChange={(e) => updateForm('rubric', e.target.value)} rows={4} disabled={rubricMode === 'locked'} />
            
            {rubricMode === 'draft' && (
              <div className="flex items-center justify-between p-3 rounded-lg border border-muted bg-background">
                <div className="flex items-center gap-2">
                  <Unlock className="w-4 h-4 text-muted-foreground" />
                  <Label htmlFor="lock-rubric" className="text-sm cursor-pointer">Lock rubric for auto-grading</Label>
                </div>
                <Switch id="lock-rubric" checked={rubricLocked} onCheckedChange={setRubricLocked} />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Generate Button - Sticky */}
        <div className="sticky bottom-4 z-10 bg-background/95 backdrop-blur-sm p-4 -mx-4 rounded-lg shadow-lg border">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <Button 
                    onClick={handleGenerateGrades} 
                    disabled={!canGenerate || grading} 
                    className="w-full" 
                    size="lg"
                  >
                    {grading ? (
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    ) : studentSubmissions.multipleStudentsWarning ? (
                      <AlertTriangle className="w-5 h-5 mr-2" />
                    ) : (
                      <Sparkles className="w-5 h-5 mr-2" />
                    )}
                    {studentSubmissions.multipleStudentsWarning 
                      ? 'Resolve Student Grouping First'
                      : studentSubmissions.totalGroups === 0
                        ? 'Upload Student Work'
                        : `Grade All Submissions (${studentSubmissions.totalGroups})`
                    }
                  </Button>
                </div>
              </TooltipTrigger>
              {gradingBlockedReason && (
                <TooltipContent><p>{gradingBlockedReason}</p></TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
          
          {/* Processing status indicator */}
          {hasAnyFiles && studentSubmissions.totalPendingPages > 0 && (
            <p className="text-xs text-center text-muted-foreground mt-2 flex items-center justify-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              Processing {studentSubmissions.totalPendingPages} file{studentSubmissions.totalPendingPages !== 1 ? 's' : ''}...
            </p>
          )}
        </div>

        {/* Results */}
        {submissionResults.length > 0 && (
          <div className="space-y-4 animate-fade-in">
            {/* Submission Tabs */}
            <div className="flex gap-2 overflow-x-auto pb-2">
              {submissionResults.map((r, idx) => (
                <Button
                  key={r.groupId}
                  variant={activeSubmissionIndex === idx ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setActiveSubmissionIndex(idx)}
                  className="whitespace-nowrap"
                >
                  {r.studentName}
                  {r.grading && <Loader2 className="w-3 h-3 ml-1 animate-spin" />}
                  {r.result && <Check className="w-3 h-3 ml-1" />}
                </Button>
              ))}
            </div>

            {activeResult?.result && (
              <>
                <Card className="border-0 shadow-md bg-primary/5">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg flex justify-between">
                      {activeResult.studentName} - Score
                      <Button variant="ghost" size="sm" onClick={() => handleCopy(activeResult.result!.score_suggestion, 'Score')}>
                        {copied === 'Score' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      </Button>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Input value={activeResult.result.score_suggestion} onChange={(e) => updateActiveResult('score_suggestion', e.target.value)} className="text-xl font-bold text-primary" />
                  </CardContent>
                </Card>

                <Card className="border-0 shadow-md">
                  <CardHeader className="pb-2"><CardTitle className="text-lg">Strengths</CardTitle></CardHeader>
                  <CardContent><Textarea value={activeResult.result.strengths} onChange={(e) => updateActiveResult('strengths', e.target.value)} rows={3} /></CardContent>
                </Card>

                <Card className="border-0 shadow-md">
                  <CardHeader className="pb-2"><CardTitle className="text-lg">Areas for Growth</CardTitle></CardHeader>
                  <CardContent><Textarea value={activeResult.result.areas_for_improvement} onChange={(e) => updateActiveResult('areas_for_improvement', e.target.value)} rows={3} /></CardContent>
                </Card>

                <Card className="border-0 shadow-md">
                  <CardHeader className="pb-2"><CardTitle className="text-lg">Feedback</CardTitle></CardHeader>
                  <CardContent><Textarea value={activeResult.result.feedback_paragraph} onChange={(e) => updateActiveResult('feedback_paragraph', e.target.value)} rows={5} /></CardContent>
                </Card>

                <div className="flex gap-2 flex-wrap">
                  <Button variant="outline" onClick={handlePreviewReport}><Eye className="w-4 h-4 mr-2" />Preview</Button>
                  <Button variant="ghost" onClick={handlePrintReport}><Printer className="w-4 h-4 mr-2" />Print</Button>
                </div>
              </>
            )}

            {activeResult?.grading && (
              <div className="text-center py-8">
                <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-2" />
                <p className="text-muted-foreground">Grading {activeResult.studentName}...</p>
              </div>
            )}

            {activeResult?.error && (
              <div className="text-center py-8 text-destructive">
                <p>Failed to grade {activeResult.studentName}</p>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Preview Modal */}
      {activeResult?.result && (
        <GradeReportPreview
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          data={{
            studentName: activeResult.studentName,
            assignmentName: assignmentName || form.subject || 'Assignment',
            score: activeResult.result.score_suggestion,
            strengths: activeResult.result.strengths,
            areasForImprovement: activeResult.result.areas_for_improvement,
            feedback: activeResult.result.feedback_paragraph,
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
