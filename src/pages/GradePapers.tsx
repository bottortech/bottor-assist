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

import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import heic2any from 'heic2any';
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
  FileSearch,
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

interface UploadedFile {
  id: string; // unique key: filename + lastModified
  file: File;
  extractedText: string;
  extractionStatus: 'pending' | 'extracting' | 'done' | 'failed';
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

  // Multi-file state
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [combinedText, setCombinedText] = useState<string>('');
  const [convertingHeic, setConvertingHeic] = useState(false);

  // Source detection state
  const [autoDetectSources, setAutoDetectSources] = useState(true);
  const [detectedSourceCount, setDetectedSourceCount] = useState<number>(0);

  // Results state (editable)
  const [result, setResult] = useState<GradingResult | null>(null);
  const [grading, setGrading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  /**
   * Generate unique ID for file
   */
  const getFileId = (f: File) => `${f.name}_${f.lastModified}`;

  /**
   * Detect distinct source sections in text
   * Looks for patterns like "Source 1", "Source A", "Source:", "[Source 1]", etc.
   */
  const detectSourcesInText = (text: string): number => {
    if (!text.trim()) return 0;

    // Common patterns for source sections
    const sourcePatterns = [
      /\bSource\s*[1-9]\b/gi,                    // Source 1, Source 2
      /\bSource\s*[A-E]\b/gi,                    // Source A, Source B
      /\[Source\s*[1-9A-E]\]/gi,                 // [Source 1], [Source A]
      /\bDocument\s*[1-9A-E]\b/gi,               // Document 1, Document A
      /\bText\s*[1-9]\b/gi,                      // Text 1, Text 2
      /\bPassage\s*[1-9]\b/gi,                   // Passage 1, Passage 2
      /\bExcerpt\s*[1-9]\b/gi,                   // Excerpt 1, Excerpt 2
      /---\s*Source\s*[1-9]/gi,                  // --- Source 1
    ];

    const foundSources = new Set<string>();

    for (const pattern of sourcePatterns) {
      const matches = text.match(pattern);
      if (matches) {
        matches.forEach(match => {
          // Normalize to detect unique sources
          const normalized = match.toLowerCase().replace(/[\[\]\s-]/g, '');
          foundSources.add(normalized);
        });
      }
    }

    return foundSources.size;
  };

  /**
   * Re-detect sources when combinedText changes (e.g., manual edits)
   */
  useEffect(() => {
    if (autoDetectSources && combinedText) {
      setDetectedSourceCount(detectSourcesInText(combinedText));
    }
  }, [combinedText, autoDetectSources]);

  /**
   * Update combined text from all uploaded files
   */
  const updateCombinedText = (files: UploadedFile[]) => {
    const parts = files.map((uf, idx) => {
      const header = `--- Page ${idx + 1}: ${uf.file.name} ---`;
      const body = uf.extractionStatus === 'failed'
        ? '[Extraction failed — paste text manually]'
        : uf.extractedText || '[Extracting...]';
      return `${header}\n${body}`;
    });
    const combined = parts.join('\n\n');
    setCombinedText(combined);
    
    // Auto-detect sources when text changes
    if (autoDetectSources) {
      setDetectedSourceCount(detectSourcesInText(combined));
    }
  };

  /**
   * [FORM UPDATE] Update form field
   */
  const updateForm = (field: keyof GradePapersForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  /**
   * Resize image blob to JPEG with max dimension
   */
  const resizeImageBlobToJpeg = async (blob: Blob, maxDimension: number): Promise<Blob> => {
    const tryBitmap = async () => {
      const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' } as any);
      const srcW = bmp.width;
      const srcH = bmp.height;
      const scale = Math.min(1, maxDimension / Math.max(srcW, srcH));
      const targetW = Math.max(1, Math.round(srcW * scale));
      const targetH = Math.max(1, Math.round(srcH * scale));

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas not supported');
      ctx.drawImage(bmp, 0, 0, targetW, targetH);
      bmp.close?.();

      return await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Failed to create output blob'))),
          'image/jpeg',
          0.85
        );
      });
    };

    try {
      return await tryBitmap();
    } catch {
      return await new Promise<Blob>((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(blob);
        img.onload = () => {
          try {
            const srcW = img.width;
            const srcH = img.height;
            const scale = Math.min(1, maxDimension / Math.max(srcW, srcH));
            const targetW = Math.max(1, Math.round(srcW * scale));
            const targetH = Math.max(1, Math.round(srcH * scale));

            const canvas = document.createElement('canvas');
            canvas.width = targetW;
            canvas.height = targetH;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Canvas not supported');
            ctx.drawImage(img, 0, 0, targetW, targetH);

            canvas.toBlob(
              (b) => {
                URL.revokeObjectURL(url);
                b ? resolve(b) : reject(new Error('Failed to create output blob'));
              },
              'image/jpeg',
              0.85
            );
          } catch (err) {
            URL.revokeObjectURL(url);
            reject(err);
          }
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error('Image decode failed'));
        };
        img.src = url;
      });
    }
  };

  /**
   * Convert HEIC to JPEG
   */
  const convertHeicToJpeg = async (heicFile: File): Promise<File> => {
    const converted = await heic2any({
      blob: heicFile,
      toType: 'image/jpeg',
      quality: 0.85,
    });
    const blob = Array.isArray(converted) ? converted[0] : converted;
    const resized = await resizeImageBlobToJpeg(blob, 2000);
    const newName = heicFile.name.replace(/\.(heic|heif)$/i, '.jpg');
    return new File([resized], newName, { type: 'image/jpeg' });
  };

  /**
   * Convert file to base64 string
   */
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  /**
   * [TEXT EXTRACTION] Extract text from a single file
   */
  const extractTextFromFile = async (fileToExtract: File): Promise<string> => {
    const base64 = await fileToBase64(fileToExtract);
    const { data, error } = await supabase.functions.invoke('extract-text', {
      body: {
        file_data: base64,
        file_type: fileToExtract.type,
        file_name: fileToExtract.name,
      },
    });
    if (error) throw error;
    return data.text || '';
  };

  /**
   * [FILE UPLOAD] Handle file selection (multi-file)
   */
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;

    const allowedMimes = [
      'application/pdf',
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'image/heic',
      'image/heif',
    ];

    const newFiles: UploadedFile[] = [];

    for (const selectedFile of Array.from(selectedFiles)) {
      const fileType = (selectedFile.type || '').toLowerCase();
      const ext = selectedFile.name.split('.').pop()?.toLowerCase();
      const okByExt = !!ext && ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'].includes(ext);
      const okByMime = allowedMimes.includes(fileType);

      if (!okByExt && !okByMime) {
        toast({
          title: 'Unsupported file type',
          description: `Skipped ${selectedFile.name}. Upload PDF or image (JPG, PNG, HEIC/HEIF).`,
          variant: 'destructive',
        });
        continue;
      }

      if (selectedFile.size > 10 * 1024 * 1024) {
        toast({
          title: 'File too large',
          description: `Skipped ${selectedFile.name}. Max 10MB.`,
          variant: 'destructive',
        });
        continue;
      }

      const isHeicOrHeif =
        fileType === 'image/heic' ||
        fileType === 'image/heif' ||
        ext === 'heic' ||
        ext === 'heif';

      let fileToProcess = selectedFile;

      if (isHeicOrHeif) {
        setConvertingHeic(true);
        try {
          fileToProcess = await convertHeicToJpeg(selectedFile);
        } catch (error) {
          console.error('HEIC conversion failed:', error);
          toast({
            title: "Couldn't read HEIC image",
            description: `Skipped ${selectedFile.name}. Upload JPG/PNG instead.`,
            variant: 'destructive',
          });
          continue;
        } finally {
          setConvertingHeic(false);
        }
      }

      // Check again after conversion
      if (fileToProcess.size > 10 * 1024 * 1024) {
        toast({
          title: 'File too large after conversion',
          description: `Skipped ${selectedFile.name}. Max 10MB.`,
          variant: 'destructive',
        });
        continue;
      }

      const id = getFileId(fileToProcess);
      // Skip duplicates
      if (uploadedFiles.some(uf => uf.id === id)) {
        continue;
      }

      newFiles.push({
        id,
        file: fileToProcess,
        extractedText: '',
        extractionStatus: 'pending',
      });
    }

    if (newFiles.length === 0) {
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    // Add to state and update combined text
    const updatedFiles = [...uploadedFiles, ...newFiles];
    setUploadedFiles(updatedFiles);
    updateCombinedText(updatedFiles);
    setResult(null);

    // Clear input for re-selection
    if (fileInputRef.current) fileInputRef.current.value = '';

    // Extract text for each new file
    for (const uf of newFiles) {
      setUploadedFiles(prev => prev.map(f =>
        f.id === uf.id ? { ...f, extractionStatus: 'extracting' } : f
      ));

      try {
        const text = await extractTextFromFile(uf.file);
        setUploadedFiles(prev => {
          const updated = prev.map(f =>
            f.id === uf.id ? { ...f, extractedText: text, extractionStatus: 'done' as const } : f
          );
          updateCombinedText(updated);
          return updated;
        });
      } catch (error) {
        console.error('Extraction failed for', uf.file.name, error);
        setUploadedFiles(prev => {
          const updated = prev.map(f =>
            f.id === uf.id ? { ...f, extractionStatus: 'failed' as const } : f
          );
          updateCombinedText(updated);
          return updated;
        });
        toast({
          title: 'Extraction failed',
          description: `Could not extract text from ${uf.file.name}. You can edit the combined text manually.`,
          variant: 'destructive',
        });
      }
    }

    toast({ title: `${newFiles.length} file(s) added` });
  };

  /**
   * [REMOVE FILE] Remove a single file from the list
   */
  const removeFile = (fileId: string) => {
    setUploadedFiles(prev => {
      const updated = prev.filter(f => f.id !== fileId);
      updateCombinedText(updated);
      return updated;
    });
  };

  /**
   * [CLEAR ALL] Remove all uploaded files
   */
  const clearAllFiles = () => {
    setUploadedFiles([]);
    setCombinedText('');
    setResult(null);
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
    if (!combinedText.trim()) {
      toast({
        title: 'No student work',
        description: 'Please upload files or paste the student work text.',
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
          student_work: combinedText,
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
        transcript: combinedText, // Store combined extracted student work
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

  const isExtracting = uploadedFiles.some(f => f.extractionStatus === 'extracting');
  const canGenerate = combinedText.trim() && form.rubric.trim() && !isExtracting;

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
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Student Work</CardTitle>
            {uploadedFiles.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAllFiles}
                className="text-muted-foreground hover:text-destructive"
              >
                Clear all
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Upload Zone */}
            <div className="relative">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif"
                onChange={handleFileSelect}
                className="hidden"
                id="file-upload"
              />
              
              <label
                htmlFor="file-upload"
                className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-muted-foreground/25 rounded-lg cursor-pointer hover:border-primary/50 transition-colors bg-muted/20"
              >
                {convertingHeic ? (
                  <>
                    <Loader2 className="w-6 h-6 text-primary mb-2 animate-spin" />
                    <span className="text-sm text-muted-foreground">Converting HEIC...</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-6 h-6 text-muted-foreground mb-2" />
                    <span className="text-sm text-muted-foreground">
                      Click to upload PDFs or images (JPG, PNG, HEIC/HEIF)
                    </span>
                    <span className="text-xs text-muted-foreground mt-1">
                      Select multiple files • Max 10MB each
                    </span>
                  </>
                )}
              </label>
            </div>

            {/* Uploaded Files List */}
            {uploadedFiles.length > 0 && (
              <div className="space-y-2">
                <Label>Uploaded Files ({uploadedFiles.length})</Label>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {uploadedFiles.map((uf, idx) => (
                    <div
                      key={uf.id}
                      className="flex items-center gap-3 p-3 border border-border rounded-lg bg-muted/20"
                    >
                      <span className="text-xs font-medium text-muted-foreground w-6">
                        {idx + 1}.
                      </span>
                      <FileText className="w-5 h-5 text-primary flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{uf.file.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {(uf.file.size / 1024).toFixed(1)} KB
                          {uf.extractionStatus === 'extracting' && ' • Extracting...'}
                          {uf.extractionStatus === 'done' && ' • Done'}
                          {uf.extractionStatus === 'failed' && ' • Extraction failed'}
                        </p>
                      </div>
                      {uf.extractionStatus === 'extracting' ? (
                        <Loader2 className="w-4 h-4 animate-spin text-primary flex-shrink-0" />
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeFile(uf.id)}
                          className="text-muted-foreground hover:text-destructive flex-shrink-0"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Combined Extracted Text */}
            <div className="space-y-2">
              <Label htmlFor="extracted_text">
                Extracted Text (combined) {isExtracting && '(Extracting...)'}
              </Label>
              <Textarea
                id="extracted_text"
                placeholder="Text extracted from files will appear here with page separators. You can also paste or type student work directly..."
                value={combinedText}
                onChange={(e) => setCombinedText(e.target.value)}
                rows={10}
                disabled={isExtracting}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                You can edit this text before grading. If extraction failed for any file, update its section manually.
              </p>
            </div>
            {/* Source Detection */}
            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 border border-border">
              <Checkbox
                id="auto-detect-sources"
                checked={autoDetectSources}
                onCheckedChange={(checked) => {
                  setAutoDetectSources(checked === true);
                  if (checked && combinedText) {
                    setDetectedSourceCount(detectSourcesInText(combinedText));
                  } else {
                    setDetectedSourceCount(0);
                  }
                }}
              />
              <div className="flex-1 space-y-1">
                <label
                  htmlFor="auto-detect-sources"
                  className="text-sm font-medium leading-none cursor-pointer flex items-center gap-2"
                >
                  <FileSearch className="w-4 h-4 text-primary" />
                  Auto-detect sources based on content (recommended)
                </label>
                <p className="text-xs text-muted-foreground">
                  Automatically identifies Source 1, Source 2, etc. in the extracted text
                </p>
                {autoDetectSources && detectedSourceCount > 0 && (
                  <p className="text-xs font-medium text-primary">
                    ✓ {detectedSourceCount} source{detectedSourceCount !== 1 ? 's' : ''} detected
                  </p>
                )}
                {autoDetectSources && combinedText.trim() && detectedSourceCount === 0 && !isExtracting && (
                  <p className="text-xs text-muted-foreground/80">
                    No distinct source labels found — content will be graded as a single submission
                  </p>
                )}
              </div>
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
