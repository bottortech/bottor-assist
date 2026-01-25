/**
 * =============================================================================
 * GRADE PAPERS PAGE (/grade)
 * =============================================================================
 * 
 * PURPOSE: Upload student work (PDF/image), provide rubric, and generate 
 * AI-powered draft grades with feedback.
 * 
 * FEATURES:
 * - Rubric: file upload + textarea, combined into rubricTextCombined
 * - Answer Key: file upload + textarea, combined into answerKeyTextCombined
 * - Student Work: auto-groups by filename pattern for batch grading
 * =============================================================================
 */

import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useSavedRubrics } from '@/hooks/useSavedRubrics';
import { useFileUpload, UploadedFileItem } from '@/hooks/useFileUpload';
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
  Info,
  CheckCircle2,
  Printer,
  Lock,
  Unlock,
  X,
  Users,
  FileText,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
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

interface StudentGroup {
  studentName: string;
  files: UploadedFileItem[];
  extractedText: string;
  result: GradingResult | null;
  grading: boolean;
}

type GradingMode = 'scoring' | 'feedback-only';
type RubricMode = 'none' | 'draft' | 'locked';

/**
 * Parse student name from filename
 * Patterns:
 *  - Lesson4_Functions__AaliyahJohnson__p1.pdf → "Aaliyah Johnson"
 *  - AaliyahJohnson_Assignment.pdf → "Aaliyah Johnson"
 *  - Student_Name_p1.jpg → "Student Name"
 */
function parseStudentNameFromFilename(filename: string): string {
  // Remove extension
  const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');
  
  // Pattern 1: Double underscore format (Lesson4__StudentName__p1)
  const doubleUnderscoreMatch = nameWithoutExt.match(/__([^_]+)__/);
  if (doubleUnderscoreMatch) {
    return formatStudentName(doubleUnderscoreMatch[1]);
  }
  
  // Pattern 2: Look for camelCase or PascalCase name patterns
  const camelCaseMatch = nameWithoutExt.match(/([A-Z][a-z]+[A-Z][a-z]+)/);
  if (camelCaseMatch) {
    return formatStudentName(camelCaseMatch[1]);
  }
  
  // Pattern 3: Underscore separated parts (try first segment if it looks like a name)
  const parts = nameWithoutExt.split(/[_\-\s]+/);
  if (parts.length >= 2) {
    // Check if first two parts could be first/last name
    const firstTwo = parts.slice(0, 2).join(' ');
    if (/^[A-Za-z]+ [A-Za-z]+$/.test(firstTwo)) {
      return firstTwo;
    }
  }
  
  return 'Unknown Student';
}

/**
 * Format camelCase/PascalCase to "First Last"
 */
function formatStudentName(name: string): string {
  // Insert space before uppercase letters
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim();
}

/**
 * Group files by parsed student name
 */
function groupFilesByStudent(files: UploadedFileItem[]): Map<string, UploadedFileItem[]> {
  const groups = new Map<string, UploadedFileItem[]>();
  
  for (const file of files) {
    const studentName = parseStudentNameFromFilename(file.fileName);
    const existing = groups.get(studentName) || [];
    groups.set(studentName, [...existing, file]);
  }
  
  return groups;
}

export default function GradePapers() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  // File input refs
  const studentFileInputRef = useRef<HTMLInputElement>(null);
  const rubricFileInputRef = useRef<HTMLInputElement>(null);
  const answerKeyFileInputRef = useRef<HTMLInputElement>(null);

  const { rubrics: savedRubrics, saveRubric, markRubricAsUsed } = useSavedRubrics();

  // File upload hooks for each section
  const studentUpload = useFileUpload({ maxConcurrentExtractions: 2, maxDimension: 1600 });
  const rubricUpload = useFileUpload({ maxConcurrentExtractions: 2, maxDimension: 1600 });
  const answerKeyUpload = useFileUpload({ maxConcurrentExtractions: 2, maxDimension: 1600 });

  const [form, setForm] = useState<GradePapersForm>({
    grade_level: '', subject: '', assignment_type: '', rubric: '', answer_key: '',
  });

  const [gradingMode, setGradingMode] = useState<GradingMode>('feedback-only');
  const [rubricMode, setRubricMode] = useState<RubricMode>('none');
  const [rubricLocked, setRubricLocked] = useState(false);
  const [detectedRubricSource, setDetectedRubricSource] = useState('');
  
  // Student groups for batch grading
  const [studentGroups, setStudentGroups] = useState<StudentGroup[]>([]);
  const [selectedGroupIndex, setSelectedGroupIndex] = useState(0);
  
  const [grading, setGrading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  // Combined text from files + manual textarea
  const rubricTextCombined = useMemo(() => {
    const parts: string[] = [];
    if (rubricUpload.combinedText.trim()) {
      parts.push('--- From Uploaded Files ---\n' + rubricUpload.combinedText);
    }
    if (form.rubric.trim()) {
      parts.push('--- From Manual Entry ---\n' + form.rubric);
    }
    return parts.join('\n\n');
  }, [rubricUpload.combinedText, form.rubric]);

  const answerKeyTextCombined = useMemo(() => {
    const parts: string[] = [];
    if (answerKeyUpload.combinedText.trim()) {
      parts.push('--- From Uploaded Files ---\n' + answerKeyUpload.combinedText);
    }
    if (form.answer_key.trim()) {
      parts.push('--- From Manual Entry ---\n' + form.answer_key);
    }
    return parts.join('\n\n');
  }, [answerKeyUpload.combinedText, form.answer_key]);

  const detectRubricInText = (text: string): boolean => {
    if (!text.trim()) return false;
    const lowerText = text.toLowerCase();
    const matches = RUBRIC_KEYWORDS.filter(k => lowerText.includes(k.toLowerCase()));
    return matches.length >= 2;
  };

  // Auto-group student files when they change
  useEffect(() => {
    const readyFiles = studentUpload.files.filter(f => f.status === 'ready');
    if (readyFiles.length === 0) {
      setStudentGroups([]);
      return;
    }
    
    const grouped = groupFilesByStudent(readyFiles);
    const groups: StudentGroup[] = Array.from(grouped.entries()).map(([name, files]) => ({
      studentName: name,
      files,
      extractedText: files.map(f => f.extractedText).join('\n\n--- PAGE BREAK ---\n\n'),
      result: null,
      grading: false,
    }));
    
    setStudentGroups(groups);
    setSelectedGroupIndex(0);
  }, [studentUpload.files]);

  // Detect rubric and update grading mode
  useEffect(() => {
    const hasRubric = rubricTextCombined.trim() || detectRubricInText(studentUpload.combinedText);
    setGradingMode(hasRubric ? 'scoring' : 'feedback-only');
    
    if (!hasRubric) {
      setRubricMode('none');
    } else if (rubricLocked) {
      setRubricMode('locked');
    } else {
      setRubricMode('draft');
    }
    
    if (rubricTextCombined.trim()) {
      if (rubricUpload.files.length > 0 && form.rubric.trim()) {
        setDetectedRubricSource('Uploaded files + Manual entry');
      } else if (rubricUpload.files.length > 0) {
        setDetectedRubricSource('Uploaded files');
      } else {
        setDetectedRubricSource('Manual entry');
      }
    } else if (detectRubricInText(studentUpload.combinedText)) {
      setDetectedRubricSource('Student work');
    } else {
      setDetectedRubricSource('');
    }
  }, [rubricTextCombined, studentUpload.combinedText, rubricLocked, rubricUpload.files.length, form.rubric]);

  const updateForm = (field: keyof GradePapersForm, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleStudentFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      studentUpload.addFiles(e.target.files);
    }
    if (studentFileInputRef.current) studentFileInputRef.current.value = '';
  };

  const handleRubricFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) rubricUpload.addFiles(e.target.files);
    if (rubricFileInputRef.current) rubricFileInputRef.current.value = '';
  };

  const handleAnswerKeyFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) answerKeyUpload.addFiles(e.target.files);
    if (answerKeyFileInputRef.current) answerKeyFileInputRef.current.value = '';
  };

  const handleGenerateGrades = async () => {
    if (studentGroups.length === 0) {
      toast({ title: 'No student work', description: 'Upload files first.', variant: 'destructive' });
      return;
    }
    
    setGrading(true);
    
    const effectiveRubric = rubricTextCombined || (detectRubricInText(studentUpload.combinedText) ? studentUpload.combinedText : '');
    
    // Grade each student group independently
    const updatedGroups = [...studentGroups];
    
    for (let i = 0; i < updatedGroups.length; i++) {
      const group = updatedGroups[i];
      updatedGroups[i] = { ...group, grading: true };
      setStudentGroups([...updatedGroups]);
      
      try {
        const { data, error } = await supabase.functions.invoke('grade-paper', {
          body: {
            student_work: group.extractedText,
            grade_level: form.grade_level,
            subject: form.subject,
            assignment_type: form.assignment_type,
            rubric: effectiveRubric,
            answer_key: answerKeyTextCombined || null,
            grading_mode: gradingMode,
          },
        });
        
        if (error) throw error;
        
        updatedGroups[i] = {
          ...group,
          grading: false,
          result: {
            score_suggestion: data.score_suggestion || 'N/A',
            strengths: data.strengths || 'Not provided',
            areas_for_improvement: data.areas_for_improvement || 'Not provided',
            feedback_paragraph: data.feedback_paragraph || 'Not provided',
          },
        };
      } catch (error) {
        console.error(`Grading error for ${group.studentName}:`, error);
        updatedGroups[i] = {
          ...group,
          grading: false,
          result: {
            score_suggestion: 'Error',
            strengths: 'Grading failed',
            areas_for_improvement: 'Please try again',
            feedback_paragraph: error instanceof Error ? error.message : 'Unknown error',
          },
        };
      }
      
      setStudentGroups([...updatedGroups]);
    }
    
    setGrading(false);
    toast({ title: `Graded ${updatedGroups.length} student(s)!` });
  };

  const updateGroupResult = (groupIndex: number, field: keyof GradingResult, value: string) => {
    setStudentGroups(prev => {
      const updated = [...prev];
      if (updated[groupIndex]?.result) {
        updated[groupIndex] = {
          ...updated[groupIndex],
          result: { ...updated[groupIndex].result!, [field]: value },
        };
      }
      return updated;
    });
  };

  const handleCopy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    toast({ title: `${label} copied!` });
    setTimeout(() => setCopied(null), 2000);
  };

  const handleDownloadPdf = async () => {
    const currentGroup = studentGroups[selectedGroupIndex];
    if (!currentGroup?.result) return;
    
    setDownloadingPdf(true);
    
    try {
      const { data, error } = await supabase.functions.invoke('generate-pdf-report', {
        body: {
          studentName: currentGroup.studentName,
          assignmentName: form.subject || 'Assignment',
          score: currentGroup.result.score_suggestion,
          strengths: currentGroup.result.strengths,
          areasForImprovement: currentGroup.result.areas_for_improvement,
          feedback: currentGroup.result.feedback_paragraph,
          gradingMode: gradingMode,
          subject: form.subject,
          gradeLevel: form.grade_level,
          generatedAt: new Date().toLocaleDateString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric'
          }),
        },
      });

      if (error) throw error;

      if (data?.fallback) {
        const printWindow = window.open('', '_blank');
        if (printWindow) {
          printWindow.document.write(data.html);
          printWindow.document.close();
          printWindow.focus();
          setTimeout(() => {
            printWindow.print();
            printWindow.close();
          }, 500);
        }
        toast({ title: 'PDF generated using print dialog' });
        return;
      }

      const blob = new Blob([data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const dateStr = new Date().toISOString().split('T')[0];
      const sanitizedStudent = currentGroup.studentName.replace(/[^a-zA-Z0-9]/g, '_');
      const sanitizedAssignment = (form.subject || 'Assignment').replace(/[^a-zA-Z0-9]/g, '_');
      const filename = `GradeReport_${sanitizedStudent}_${sanitizedAssignment}_${dateStr}.pdf`;
      
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      toast({ title: 'PDF downloaded!' });
    } catch (error) {
      console.error('PDF download error:', error);
      toast({ title: 'PDF download failed', variant: 'destructive' });
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handlePrintReport = () => {
    const currentGroup = studentGroups[selectedGroupIndex];
    if (!currentGroup?.result) return;
    
    const printContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Grade Report - ${currentGroup.studentName}</title>
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
          <div class="meta-item"><div class="meta-label">Student</div><div class="meta-value">${currentGroup.studentName}</div></div>
          ${form.subject ? `<div class="meta-item"><div class="meta-label">Subject</div><div class="meta-value">${form.subject}</div></div>` : ''}
          ${form.grade_level ? `<div class="meta-item"><div class="meta-label">Grade Level</div><div class="meta-value">${form.grade_level}</div></div>` : ''}
        </div>
        ${gradingMode === 'scoring' && currentGroup.result.score_suggestion !== 'N/A' ? `
          <div class="score-box">
            <div class="score-label">Suggested Score</div>
            <div class="score-value">${currentGroup.result.score_suggestion}</div>
          </div>
        ` : ''}
        <div class="section"><div class="section-title">Strengths</div><div class="section-content">${currentGroup.result.strengths}</div></div>
        <div class="section"><div class="section-title">Areas for Improvement</div><div class="section-content">${currentGroup.result.areas_for_improvement}</div></div>
        <div class="section"><div class="section-title">Draft Feedback</div><div class="section-content">${currentGroup.result.feedback_paragraph}</div></div>
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
    const currentGroup = studentGroups[selectedGroupIndex];
    if (!user || !currentGroup?.result) return;
    
    setSaving(true);
    try {
      const sessionData = {
        user_id: user.id,
        status: 'completed',
        title: `${currentGroup.studentName} - ${form.subject || 'Grading'}`,
        snippet: `Score: ${currentGroup.result.score_suggestion}`,
        summary_json: { 
          ...currentGroup.result, 
          input_type: 'grading', 
          grading_mode: gradingMode, 
          studentName: currentGroup.studentName 
        },
        teacher_notes: JSON.stringify(form),
        transcript: currentGroup.extractedText,
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

  const isExtracting = studentUpload.isExtracting || rubricUpload.isExtracting || answerKeyUpload.isExtracting;
  const canGenerate = studentUpload.hasReadyFiles && !isExtracting && !grading;
  const currentGroup = studentGroups[selectedGroupIndex];

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
        {/* ===== STUDENT WORK (REQUIRED) ===== */}
        <Card className="border-2 border-primary/30 shadow-lg bg-primary/5">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg">Student Work (Required)</CardTitle>
              <CardDescription className="text-xs">
                Upload PDFs or images. Files are auto-grouped by student name in filename.
              </CardDescription>
            </div>
            {studentUpload.files.length > 0 && (
              <Button variant="ghost" size="sm" onClick={studentUpload.clearAllFiles} className="text-muted-foreground hover:text-destructive">
                Clear all
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <input 
                ref={studentFileInputRef} 
                type="file" 
                multiple 
                accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif" 
                onChange={handleStudentFileSelect} 
                className="hidden" 
                id="student-file-upload" 
              />
              <label 
                htmlFor="student-file-upload" 
                className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-muted-foreground/25 rounded-lg cursor-pointer hover:border-primary/50 transition-colors bg-muted/20"
              >
                <Upload className="w-6 h-6 text-muted-foreground mb-2" />
                <span className="text-sm text-muted-foreground">Click to upload PDFs or images</span>
                <span className="text-xs text-muted-foreground mt-1">
                  Filename format: Assignment__StudentName__p1.pdf
                </span>
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

            {/* Student Groups Preview */}
            {studentGroups.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-primary" />
                  <Label className="text-sm font-medium">Detected Students ({studentGroups.length})</Label>
                </div>
                <div className="flex flex-wrap gap-2">
                  {studentGroups.map((group, idx) => (
                    <Badge 
                      key={group.studentName} 
                      variant={idx === selectedGroupIndex ? 'default' : 'outline'}
                      className="cursor-pointer"
                      onClick={() => setSelectedGroupIndex(idx)}
                    >
                      {group.studentName} ({group.files.length} file{group.files.length !== 1 ? 's' : ''})
                      {group.result && <Check className="w-3 h-3 ml-1" />}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ===== RUBRIC / GRADING CRITERIA (OPTIONAL) ===== */}
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
            {/* Rubric File Upload */}
            <div className="space-y-2">
              <Label className="text-sm">Upload Rubric Files</Label>
              <div className="relative">
                <input 
                  ref={rubricFileInputRef} 
                  type="file" 
                  multiple 
                  accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif" 
                  onChange={handleRubricFileSelect} 
                  className="hidden" 
                  id="rubric-file-upload" 
                  disabled={rubricMode === 'locked'}
                />
                <label 
                  htmlFor="rubric-file-upload" 
                  className={`flex items-center justify-center w-full h-16 border-2 border-dashed rounded-lg transition-colors ${
                    rubricMode === 'locked' 
                      ? 'border-muted/50 bg-muted/10 cursor-not-allowed opacity-50' 
                      : 'border-muted-foreground/25 cursor-pointer hover:border-primary/50 bg-muted/20'
                  }`}
                >
                  <Upload className="w-4 h-4 text-muted-foreground mr-2" />
                  <span className="text-sm text-muted-foreground">Upload rubric PDFs or images</span>
                </label>
              </div>
              
              {/* Uploaded Rubric Files List */}
              {rubricUpload.files.length > 0 && (
                <div className="space-y-1">
                  {rubricUpload.files.map(file => (
                    <div key={file.id} className="flex items-center justify-between p-2 bg-muted/30 rounded-md">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        <span className="text-sm truncate">{file.fileName}</span>
                        <Badge variant="outline" className="text-xs flex-shrink-0">
                          {file.status === 'ready' ? 'Ready' : file.status}
                        </Badge>
                      </div>
                      {rubricMode !== 'locked' && (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => rubricUpload.removeFile(file.id)}
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            {/* Rubric Textarea */}
            <div className="space-y-2">
              <Label className="text-sm">Or Paste Rubric Text</Label>
              <Textarea
                placeholder="Paste your rubric or grading criteria here..."
                value={form.rubric}
                onChange={(e) => updateForm('rubric', e.target.value)}
                rows={5}
                disabled={rubricMode === 'locked'}
                className={rubricMode === 'locked' ? 'opacity-75 bg-muted/20' : ''}
              />
            </div>
            
            {/* Rubric Mode Status */}
            {rubricMode === 'none' && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/30 border border-muted">
                <Info className="w-4 h-4 text-muted-foreground" />
                <div className="flex-1">
                  <span className="text-sm text-muted-foreground">No rubric detected — Feedback-only mode</span>
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
                      <p className="text-xs text-primary/70 mt-0.5">Source: {detectedRubricSource}</p>
                    )}
                  </div>
                </div>
                
                <div className="flex items-center justify-between p-3 rounded-lg border border-muted bg-background">
                  <div className="flex items-center gap-2">
                    <Unlock className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <Label htmlFor="lock-rubric" className="text-sm font-medium cursor-pointer">
                        Lock rubric for auto-grading
                      </Label>
                      <p className="text-xs text-muted-foreground">Hides manual options</p>
                    </div>
                  </div>
                  <Switch id="lock-rubric" checked={rubricLocked} onCheckedChange={setRubricLocked} />
                </div>
              </div>
            )}
            
            {rubricMode === 'locked' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/30">
                  <Lock className="w-4 h-4 text-green-600" />
                  <div className="flex-1">
                    <span className="text-sm text-green-700 dark:text-green-400 font-medium">Rubric locked — Auto-grading enabled</span>
                    {detectedRubricSource && (
                      <p className="text-xs text-green-600/70 mt-0.5">Source: {detectedRubricSource}</p>
                    )}
                  </div>
                </div>
                
                <div className="flex items-center justify-between p-3 rounded-lg border border-green-500/30 bg-background">
                  <div className="flex items-center gap-2">
                    <Lock className="w-4 h-4 text-green-600" />
                    <Label htmlFor="lock-rubric" className="text-sm font-medium cursor-pointer">Rubric locked</Label>
                  </div>
                  <Switch id="lock-rubric" checked={rubricLocked} onCheckedChange={setRubricLocked} />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ===== MANUAL OPTIONS (when not locked) ===== */}
        {rubricMode !== 'locked' && (
          <Card className="border border-muted">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Info className="w-4 h-4" />
                Manual Grading Options
              </CardTitle>
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
                      {SUBJECTS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
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
                      {GRADES.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
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
                    {ASSIGNMENT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {/* Answer Key (Optional) - inside Manual Grading Options */}
              <div className="pt-3 border-t border-muted space-y-3">
                <Label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <FileSearch className="w-4 h-4" />
                  Answer Key
                  <span className="text-xs font-normal">Optional</span>
                </Label>
                
                {/* Answer Key File Upload */}
                <div className="space-y-2">
                  <div className="relative">
                    <input 
                      ref={answerKeyFileInputRef} 
                      type="file" 
                      multiple 
                      accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif" 
                      onChange={handleAnswerKeyFileSelect} 
                      className="hidden" 
                      id="answerkey-file-upload" 
                    />
                    <label 
                      htmlFor="answerkey-file-upload" 
                      className="flex items-center justify-center w-full h-14 border-2 border-dashed border-muted-foreground/25 rounded-lg cursor-pointer hover:border-primary/50 transition-colors bg-muted/20"
                    >
                      <Upload className="w-4 h-4 text-muted-foreground mr-2" />
                      <span className="text-sm text-muted-foreground">Upload answer key files</span>
                    </label>
                  </div>
                  
                  {/* Uploaded Answer Key Files List */}
                  {answerKeyUpload.files.length > 0 && (
                    <div className="space-y-1">
                      {answerKeyUpload.files.map(file => (
                        <div key={file.id} className="flex items-center justify-between p-2 bg-muted/30 rounded-md">
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                            <span className="text-sm truncate">{file.fileName}</span>
                            <Badge variant="outline" className="text-xs flex-shrink-0">
                              {file.status === 'ready' ? 'Ready' : file.status}
                            </Badge>
                          </div>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => answerKeyUpload.removeFile(file.id)}
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                
                {/* Answer Key Textarea */}
                <Textarea
                  placeholder="Or paste answer key here..."
                  value={form.answer_key}
                  onChange={(e) => updateForm('answer_key', e.target.value)}
                  rows={3}
                  className="text-sm"
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* ===== GENERATE BUTTON ===== */}
        <div className="sticky bottom-4 z-10 bg-background/95 backdrop-blur-sm p-4 -mx-4 rounded-lg shadow-lg border">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <Button onClick={handleGenerateGrades} disabled={!canGenerate} className="w-full" size="lg">
                    {grading ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Sparkles className="w-5 h-5 mr-2" />}
                    {studentGroups.length > 1 
                      ? `Grade All Students (${studentGroups.length})` 
                      : 'Generate Draft Grade + Feedback'
                    }
                  </Button>
                </div>
              </TooltipTrigger>
              {!canGenerate && isExtracting && (
                <TooltipContent><p>Waiting for text extraction...</p></TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* ===== RESULTS ===== */}
        {currentGroup?.result && (
          <div className="space-y-4 animate-fade-in">
            {/* Student Selector Tabs */}
            {studentGroups.length > 1 && (
              <Card className="border border-muted">
                <CardContent className="p-3">
                  <div className="flex flex-wrap gap-2">
                    {studentGroups.map((group, idx) => (
                      <Button
                        key={group.studentName}
                        variant={idx === selectedGroupIndex ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setSelectedGroupIndex(idx)}
                      >
                        {group.studentName}
                        {group.result && <Check className="w-3 h-3 ml-1" />}
                      </Button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            <Card className="border-0 shadow-md bg-primary/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex justify-between">
                  <span>
                    {studentGroups.length > 1 ? `${currentGroup.studentName} — ` : ''}Suggested Score
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => handleCopy(currentGroup.result!.score_suggestion, 'Score')}>
                    {copied === 'Score' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Input 
                  value={currentGroup.result.score_suggestion} 
                  onChange={(e) => updateGroupResult(selectedGroupIndex, 'score_suggestion', e.target.value)} 
                  className="text-xl font-bold text-primary" 
                />
              </CardContent>
            </Card>

            <Card className="border-0 shadow-md">
              <CardHeader className="pb-2"><CardTitle className="text-lg">Strengths</CardTitle></CardHeader>
              <CardContent>
                <Textarea 
                  value={currentGroup.result.strengths} 
                  onChange={(e) => updateGroupResult(selectedGroupIndex, 'strengths', e.target.value)} 
                  rows={3} 
                />
              </CardContent>
            </Card>

            <Card className="border-0 shadow-md">
              <CardHeader className="pb-2"><CardTitle className="text-lg">Areas for Improvement</CardTitle></CardHeader>
              <CardContent>
                <Textarea 
                  value={currentGroup.result.areas_for_improvement} 
                  onChange={(e) => updateGroupResult(selectedGroupIndex, 'areas_for_improvement', e.target.value)} 
                  rows={3} 
                />
              </CardContent>
            </Card>

            <Card className="border-0 shadow-md">
              <CardHeader className="pb-2"><CardTitle className="text-lg">Draft Feedback</CardTitle></CardHeader>
              <CardContent>
                <Textarea 
                  value={currentGroup.result.feedback_paragraph} 
                  onChange={(e) => updateGroupResult(selectedGroupIndex, 'feedback_paragraph', e.target.value)} 
                  rows={5} 
                />
              </CardContent>
            </Card>

            <div className="flex flex-wrap gap-3">
              <Button variant="outline" onClick={handleDownloadPdf} disabled={downloadingPdf} className="flex-1 min-w-[140px]">
                {downloadingPdf ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                Download PDF
              </Button>
              <Button variant="ghost" onClick={handlePrintReport} className="min-w-[120px]">
                <Printer className="w-4 h-4 mr-2" />Print Report
              </Button>
              <Button onClick={handleSave} disabled={saving} className="flex-1 min-w-[100px]">
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
