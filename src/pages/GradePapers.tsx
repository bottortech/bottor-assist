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
 * RUBRIC-FIRST GRADING:
 * - Uses teacher-provided rubric text OR rubric detected from documents
 * - If no rubric detected, switches to "Feedback-only" mode
 * 
 * DATA FLOW:
 * 1. [INPUT] User fills assignment details + rubric + optional answer key
 * 2. [UPLOAD] User uploads assignment/rubric docs AND student work
 * 3. [EXTRACT] Edge function extracts text from files
 * 4. [DETECT] Detect rubric from textbox → assignment docs → student work
 * 5. [AI CALL] Generate grade + feedback via edge function
 * 6. [EDIT] User can edit all outputs before saving
 * 7. [SAVE] Persist session with assignment data and feedback
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
import { useSavedRubrics } from '@/hooks/useSavedRubrics';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
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
  ChevronDown,
  ChevronRight,
  Info,
  AlertTriangle,
  CheckCircle2,
  BookOpen,
  History,
  Bookmark,
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

// Keywords that indicate rubric/criteria content
const RUBRIC_KEYWORDS = [
  'rubric',
  'criteria',
  'points',
  'total',
  'score',
  'each',
  'x3',
  'x2',
  'requirements',
  'grading',
  'evaluation',
  'pts',
  'point value',
  'scoring',
  '/5',
  '/10',
  '/15',
  '/20',
  '/25',
  '/50',
  '/100',
];

// Keywords that indicate objective content (math, fill-in, multiple choice)
const OBJECTIVE_CONTENT_KEYWORDS = [
  'answer',
  'correct',
  'solve',
  'calculate',
  'compute',
  'find the value',
  'what is',
  'how many',
  'which of the following',
  'choose the best',
  'select the correct',
  'fill in the blank',
  'true or false',
  'multiple choice',
  'a)',
  'b)',
  'c)',
  'd)',
  '1)',
  '2)',
  '3)',
  '= ',
  '+ ',
  '- ',
  '× ',
  '÷ ',
];

// Keywords that indicate open-ended/subjective content (reading, writing, ELA)
const OPEN_ENDED_KEYWORDS = [
  'explain',
  'describe',
  'analyze',
  'compare',
  'contrast',
  'discuss',
  'evaluate',
  'argue',
  'persuade',
  'support your answer',
  'cite evidence',
  'text evidence',
  'main idea',
  'author\'s purpose',
  'theme',
  'central claim',
  'essay',
  'paragraph',
  'response',
  'reading passage',
  'comprehension',
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

type GradingMode = 'scoring' | 'feedback-only';

/**
 * =============================================================================
 * COMPONENT
 * =============================================================================
 */

export default function GradePapers() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const studentFileInputRef = useRef<HTMLInputElement>(null);
  const assignmentFileInputRef = useRef<HTMLInputElement>(null);
  const answerKeyFileInputRef = useRef<HTMLInputElement>(null);

  // Saved rubrics hook
  const { 
    rubrics: savedRubrics, 
    loading: rubricsLoading, 
    saveRubric, 
    markRubricAsUsed 
  } = useSavedRubrics();

  // Form state
  const [form, setForm] = useState<GradePapersForm>({
    grade_level: '',
    subject: '',
    assignment_type: '',
    rubric: '',
    answer_key: '',
  });

  // Multi-file state for Student Work
  const [studentFiles, setStudentFiles] = useState<UploadedFile[]>([]);
  const [studentCombinedText, setStudentCombinedText] = useState<string>('');
  
  // Multi-file state for Assignment/Rubric Documents
  const [assignmentFiles, setAssignmentFiles] = useState<UploadedFile[]>([]);
  const [assignmentCombinedText, setAssignmentCombinedText] = useState<string>('');
  
  // Multi-file state for Answer Key Documents
  const [answerKeyFiles, setAnswerKeyFiles] = useState<UploadedFile[]>([]);
  const [answerKeyCombinedText, setAnswerKeyCombinedText] = useState<string>('');
  
  const [convertingHeic, setConvertingHeic] = useState(false);

  // Source detection state
  const [autoDetectSources, setAutoDetectSources] = useState(true);
  const [detectedSourceCount, setDetectedSourceCount] = useState<number>(0);

  // Rubric detection state
  const [gradingMode, setGradingMode] = useState<GradingMode>('feedback-only');
  const [detectedRubricSource, setDetectedRubricSource] = useState<string>('');

  // Saved rubrics UI state
  const [showSaveRubricPrompt, setShowSaveRubricPrompt] = useState(false);
  const [rubricNameInput, setRubricNameInput] = useState('');
  const [savingRubric, setSavingRubric] = useState(false);
  const [showDetectedRubricSuggestion, setShowDetectedRubricSuggestion] = useState(false);
  const [detectedRubricContent, setDetectedRubricContent] = useState('');

  // Results state (editable)
  const [result, setResult] = useState<GradingResult | null>(null);
  const [grading, setGrading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  // Collapsible section state
  const [optionalContextOpen, setOptionalContextOpen] = useState(false);
  const [answerKeyOpen, setAnswerKeyOpen] = useState(false);

  /**
   * Generate unique ID for file
   */
  const getFileId = (f: File) => `${f.name}_${f.lastModified}`;

  /**
   * Detect if text contains rubric/criteria keywords
   */
  const detectRubricInText = (text: string): boolean => {
    if (!text.trim()) return false;
    const lowerText = text.toLowerCase();
    
    // Check for keyword matches
    const keywordMatches = RUBRIC_KEYWORDS.filter(keyword => 
      lowerText.includes(keyword.toLowerCase())
    );
    
    // Need at least 2 keyword matches to be confident it's a rubric
    return keywordMatches.length >= 2;
  };

  /**
   * Detect content type: objective (math, fill-in) vs open-ended (reading, writing)
   * Returns: 'objective' | 'open-ended' | 'mixed'
   */
  const detectContentType = (text: string): 'objective' | 'open-ended' | 'mixed' => {
    if (!text.trim()) return 'mixed';
    const lowerText = text.toLowerCase();
    
    const objectiveMatches = OBJECTIVE_CONTENT_KEYWORDS.filter(keyword => 
      lowerText.includes(keyword.toLowerCase())
    ).length;
    
    const openEndedMatches = OPEN_ENDED_KEYWORDS.filter(keyword => 
      lowerText.includes(keyword.toLowerCase())
    ).length;
    
    // Determine dominant type with threshold
    if (objectiveMatches >= 3 && objectiveMatches > openEndedMatches * 2) {
      return 'objective';
    }
    if (openEndedMatches >= 3 && openEndedMatches > objectiveMatches * 2) {
      return 'open-ended';
    }
    return 'mixed';
  };

  /**
   * Get descriptive source label based on file names
   */
  const getDescriptiveSourceLabel = (
    files: UploadedFile[],
    fallbackLabel: string
  ): string => {
    if (files.length === 0) return fallbackLabel;
    
    // Check file names for common patterns
    const fileNames = files.map(f => f.file.name.toLowerCase()).join(' ');
    
    if (fileNames.includes('worksheet')) return 'uploaded worksheet';
    if (fileNames.includes('packet')) return 'student packet';
    if (fileNames.includes('workbook')) return 'uploaded workbook';
    if (fileNames.includes('rubric')) return 'uploaded rubric document';
    if (fileNames.includes('answer') || fileNames.includes('key')) return 'answer key';
    if (fileNames.includes('test') || fileNames.includes('quiz')) return 'uploaded test/quiz';
    if (fileNames.includes('assignment')) return 'assignment document';
    
    // Fallback to generic label with file count
    if (files.length > 1) {
      return `${files.length} uploaded documents`;
    }
    return fallbackLabel;
  };

  /**
   * Combine and aggregate rubric criteria from multiple document sources
   * Returns: { hasRubric: boolean, source: string, combinedCriteria: string }
   */
  const aggregateRubricFromSources = (): { 
    hasRubric: boolean; 
    source: string; 
    combinedCriteria: string;
    contentType: 'objective' | 'open-ended' | 'mixed';
  } => {
    const sources: { text: string; label: string; priority: number; files: UploadedFile[] }[] = [];
    
    // Priority 1: Teacher typed rubric
    if (form.rubric.trim()) {
      return {
        hasRubric: true,
        source: 'Rubric textbox',
        combinedCriteria: form.rubric,
        contentType: detectContentType(form.rubric),
      };
    }
    
    // Collect all potential rubric sources
    if (assignmentCombinedText.trim()) {
      sources.push({
        text: assignmentCombinedText,
        label: getDescriptiveSourceLabel(assignmentFiles, 'Assignment/Rubric documents'),
        priority: 2,
        files: assignmentFiles,
      });
    }
    
    if (answerKeyCombinedText.trim()) {
      sources.push({
        text: answerKeyCombinedText,
        label: getDescriptiveSourceLabel(answerKeyFiles, 'Answer key'),
        priority: 3,
        files: answerKeyFiles,
      });
    }
    
    if (studentCombinedText.trim()) {
      sources.push({
        text: studentCombinedText,
        label: getDescriptiveSourceLabel(studentFiles, 'Student work documents'),
        priority: 4,
        files: studentFiles,
      });
    }
    
    // Find sources with rubric content
    const rubricSources = sources.filter(s => detectRubricInText(s.text));
    
    if (rubricSources.length === 0) {
      // No rubric found, but check if answer key exists (can still help objective grading)
      const contentType = detectContentType(studentCombinedText);
      return {
        hasRubric: false,
        source: '',
        combinedCriteria: '',
        contentType,
      };
    }
    
    // Use highest priority source
    const primarySource = rubricSources.sort((a, b) => a.priority - b.priority)[0];
    
    // Build source label
    let sourceLabel = primarySource.label;
    if (rubricSources.length > 1) {
      sourceLabel = `${primarySource.label} (+${rubricSources.length - 1} more)`;
    }
    
    // Combine criteria from all sources for more complete context
    const combinedCriteria = rubricSources.map(s => s.text).join('\n\n--- Additional Criteria ---\n\n');
    
    return {
      hasRubric: true,
      source: sourceLabel,
      combinedCriteria,
      contentType: detectContentType(combinedCriteria),
    };
  };

  // Track detected content type for smart fallback behavior
  const [detectedContentType, setDetectedContentType] = useState<'objective' | 'open-ended' | 'mixed'>('mixed');

  /**
   * Determine grading mode based on rubric priority order with multi-document support
   */
  useEffect(() => {
    const { hasRubric, source, contentType } = aggregateRubricFromSources();
    
    setDetectedContentType(contentType);
    
    if (hasRubric) {
      setGradingMode('scoring');
      setDetectedRubricSource(source);
    } else {
      setGradingMode('feedback-only');
      setDetectedRubricSource('');
    }
  }, [form.rubric, assignmentCombinedText, studentCombinedText, answerKeyCombinedText, assignmentFiles, studentFiles, answerKeyFiles]);

  /**
   * Detect distinct source sections in text
   */
  const detectSourcesInText = (text: string): number => {
    if (!text.trim()) return 0;

    const sourcePatterns = [
      /\bSource\s*[1-9]\b/gi,
      /\bSource\s*[A-E]\b/gi,
      /\[Source\s*[1-9A-E]\]/gi,
      /\bDocument\s*[1-9A-E]\b/gi,
      /\bText\s*[1-9]\b/gi,
      /\bPassage\s*[1-9]\b/gi,
      /\bExcerpt\s*[1-9]\b/gi,
      /---\s*Source\s*[1-9]/gi,
    ];

    const foundSources = new Set<string>();

    for (const pattern of sourcePatterns) {
      const matches = text.match(pattern);
      if (matches) {
        matches.forEach(match => {
          const normalized = match.toLowerCase().replace(/[\[\]\s-]/g, '');
          foundSources.add(normalized);
        });
      }
    }

    return foundSources.size;
  };

  /**
   * Re-detect sources when studentCombinedText changes
   */
  useEffect(() => {
    if (autoDetectSources && studentCombinedText) {
      setDetectedSourceCount(detectSourcesInText(studentCombinedText));
    }
  }, [studentCombinedText, autoDetectSources]);

  /**
   * Trigger rubric detection suggestion when assignment/student docs have rubric content
   */
  useEffect(() => {
    // Only suggest if no rubric is manually entered
    if (form.rubric.trim()) return;
    
    // Check assignment documents first (higher priority)
    if (assignmentCombinedText.trim() && detectRubricInText(assignmentCombinedText)) {
      setDetectedRubricContent(assignmentCombinedText);
      setShowDetectedRubricSuggestion(true);
      return;
    }
    
    // Then check student work
    if (studentCombinedText.trim() && detectRubricInText(studentCombinedText)) {
      setDetectedRubricContent(studentCombinedText);
      setShowDetectedRubricSuggestion(true);
      return;
    }
    
    // No rubric detected - clear suggestion
    setShowDetectedRubricSuggestion(false);
    setDetectedRubricContent('');
  }, [assignmentCombinedText, studentCombinedText, form.rubric]);

  /**
   * Update combined text from uploaded files
   */
  const updateCombinedText = (
    files: UploadedFile[],
    setter: React.Dispatch<React.SetStateAction<string>>
  ) => {
    const parts = files.map((uf, idx) => {
      const header = `--- Page ${idx + 1}: ${uf.file.name} ---`;
      const body = uf.extractionStatus === 'failed'
        ? '[Extraction failed — paste text manually]'
        : uf.extractedText || '[Extracting...]';
      return `${header}\n${body}`;
    });
    const combined = parts.join('\n\n');
    setter(combined);
  };

  /**
   * [FORM UPDATE] Update form field
   */
  const updateForm = (field: keyof GradePapersForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  /**
   * [RUBRIC REUSE] Handle selecting a saved rubric
   */
  const handleSelectSavedRubric = async (rubricId: string) => {
    const selected = savedRubrics.find(r => r.id === rubricId);
    if (selected) {
      updateForm('rubric', selected.content);
      await markRubricAsUsed(rubricId);
      toast({
        title: 'Rubric applied',
        description: `"${selected.name}" has been loaded into the rubric field.`,
      });
    }
  };

  /**
   * [RUBRIC REUSE] Handle saving current rubric for future use
   */
  const handleSaveRubric = async () => {
    if (!form.rubric.trim()) return;
    
    const name = rubricNameInput.trim() || `Rubric - ${new Date().toLocaleDateString()}`;
    setSavingRubric(true);
    
    try {
      await saveRubric(name, form.rubric, form.subject, form.grade_level);
      setShowSaveRubricPrompt(false);
      setRubricNameInput('');
      toast({
        title: 'Rubric saved',
        description: `"${name}" has been saved for future use.`,
      });
    } catch (err) {
      toast({
        title: 'Failed to save rubric',
        description: 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSavingRubric(false);
    }
  };

  /**
   * [RUBRIC DETECTION] Handle using detected rubric from documents
   */
  const handleUseDetectedRubric = () => {
    if (detectedRubricContent) {
      updateForm('rubric', detectedRubricContent);
      setShowDetectedRubricSuggestion(false);
      toast({
        title: 'Rubric applied',
        description: 'Detected rubric has been loaded. You can edit it as needed.',
      });
    }
  };

  /**
   * Format relative time for rubric last used date
   */
  const formatRelativeTime = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Used today';
    if (diffDays === 1) return 'Used yesterday';
    if (diffDays < 7) return `Used ${diffDays} days ago`;
    if (diffDays < 30) return `Used ${Math.floor(diffDays / 7)} week${Math.floor(diffDays / 7) > 1 ? 's' : ''} ago`;
    return `Used ${date.toLocaleDateString()}`;
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
   * [FILE UPLOAD] Generic handler for multi-file upload
   */
  const handleFileSelect = async (
    e: React.ChangeEvent<HTMLInputElement>,
    existingFiles: UploadedFile[],
    setFiles: React.Dispatch<React.SetStateAction<UploadedFile[]>>,
    setCombinedText: React.Dispatch<React.SetStateAction<string>>,
    inputRef: React.RefObject<HTMLInputElement>
  ) => {
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

      if (fileToProcess.size > 10 * 1024 * 1024) {
        toast({
          title: 'File too large after conversion',
          description: `Skipped ${selectedFile.name}. Max 10MB.`,
          variant: 'destructive',
        });
        continue;
      }

      const id = getFileId(fileToProcess);
      if (existingFiles.some(uf => uf.id === id)) {
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
      if (inputRef.current) inputRef.current.value = '';
      return;
    }

    const updatedFiles = [...existingFiles, ...newFiles];
    setFiles(updatedFiles);
    updateCombinedText(updatedFiles, setCombinedText);
    setResult(null);

    if (inputRef.current) inputRef.current.value = '';

    // Extract text for each new file
    for (const uf of newFiles) {
      setFiles(prev => prev.map(f =>
        f.id === uf.id ? { ...f, extractionStatus: 'extracting' } : f
      ));

      try {
        const text = await extractTextFromFile(uf.file);
        setFiles(prev => {
          const updated = prev.map(f =>
            f.id === uf.id ? { ...f, extractedText: text, extractionStatus: 'done' as const } : f
          );
          updateCombinedText(updated, setCombinedText);
          return updated;
        });
      } catch (error) {
        console.error('Extraction failed for', uf.file.name, error);
        setFiles(prev => {
          const updated = prev.map(f =>
            f.id === uf.id ? { ...f, extractionStatus: 'failed' as const } : f
          );
          updateCombinedText(updated, setCombinedText);
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
   * [STUDENT FILE UPLOAD] Handle student work file selection
   */
  const handleStudentFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFileSelect(e, studentFiles, setStudentFiles, setStudentCombinedText, studentFileInputRef);
  };

  /**
   * [ASSIGNMENT FILE UPLOAD] Handle assignment/rubric file selection
   */
  const handleAssignmentFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFileSelect(e, assignmentFiles, setAssignmentFiles, setAssignmentCombinedText, assignmentFileInputRef);
  };

  /**
   * [ANSWER KEY FILE UPLOAD] Handle answer key file selection
   */
  const handleAnswerKeyFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFileSelect(e, answerKeyFiles, setAnswerKeyFiles, setAnswerKeyCombinedText, answerKeyFileInputRef);
  };

  /**
   * [REMOVE FILE] Remove a single file from a list
   */
  const removeFile = (
    fileId: string,
    setFiles: React.Dispatch<React.SetStateAction<UploadedFile[]>>,
    setCombinedText: React.Dispatch<React.SetStateAction<string>>
  ) => {
    setFiles(prev => {
      const updated = prev.filter(f => f.id !== fileId);
      updateCombinedText(updated, setCombinedText);
      return updated;
    });
  };

  /**
   * [CLEAR ALL] Remove all files from a list
   */
  const clearAllFiles = (
    setFiles: React.Dispatch<React.SetStateAction<UploadedFile[]>>,
    setCombinedText: React.Dispatch<React.SetStateAction<string>>,
    inputRef: React.RefObject<HTMLInputElement>
  ) => {
    setFiles([]);
    setCombinedText('');
    setResult(null);
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  /**
   * Get effective rubric text based on priority (uses aggregated sources)
   */
  const getEffectiveRubric = (): string => {
    const { combinedCriteria } = aggregateRubricFromSources();
    return combinedCriteria;
  };

  /**
   * [AI GRADING] Generate grade and feedback
   */
  const handleGenerateGrade = async () => {
    if (!studentCombinedText.trim()) {
      toast({
        title: 'No student work',
        description: 'Please upload files or paste the student work text.',
        variant: 'destructive',
      });
      return;
    }

    setGrading(true);
    try {
      const effectiveRubric = getEffectiveRubric();
      
      // Combine pasted answer key with uploaded answer key text
      const combinedAnswerKey = [form.answer_key, answerKeyCombinedText]
        .filter(Boolean)
        .join('\n\n--- Uploaded Answer Key ---\n\n');
      
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
          content_type: detectedContentType, // Smart fallback: objective vs open-ended
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
   */
  const handleSave = async () => {
    if (!user || !result) return;

    setSaving(true);
    try {
      const summaryJson = {
        score_suggestion: result.score_suggestion,
        strengths: [result.strengths],
        areas_for_improvement: [result.areas_for_improvement],
        feedback_paragraph: result.feedback_paragraph,
        input_type: 'grading',
        grading_mode: gradingMode,
      };

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
        transcript: studentCombinedText,
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

  const isStudentExtracting = studentFiles.some(f => f.extractionStatus === 'extracting');
  const isAssignmentExtracting = assignmentFiles.some(f => f.extractionStatus === 'extracting');
  const isAnswerKeyExtracting = answerKeyFiles.some(f => f.extractionStatus === 'extracting');
  const isExtracting = isStudentExtracting || isAssignmentExtracting || isAnswerKeyExtracting;
  const canGenerate = studentCombinedText.trim() && !isExtracting;

  /**
   * Render file list component
   */
  const FileList = ({
    files,
    setFiles,
    setCombinedText,
    label,
  }: {
    files: UploadedFile[];
    setFiles: React.Dispatch<React.SetStateAction<UploadedFile[]>>;
    setCombinedText: React.Dispatch<React.SetStateAction<string>>;
    label: string;
  }) => (
    <div className="space-y-2">
      <Label>{label} ({files.length})</Label>
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {files.map((uf, idx) => (
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
                onClick={() => removeFile(uf.id, setFiles, setCombinedText)}
                className="text-muted-foreground hover:text-destructive flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );

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
        {/* Section 1: Student Work Upload (Required - primary) */}
        <Card className="border-2 border-primary/30 shadow-lg bg-primary/5">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg">Student Work (Required)</CardTitle>
              <CardDescription className="text-xs text-muted-foreground mt-1">
                Upload student work as PDFs or images. Review and edit extracted text before grading.
              </CardDescription>
            </div>
            {studentFiles.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => clearAllFiles(setStudentFiles, setStudentCombinedText, studentFileInputRef)}
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
                ref={studentFileInputRef}
                type="file"
                multiple
                accept=".pdf,application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif"
                onChange={handleStudentFileSelect}
                className="hidden"
                id="student-file-upload"
              />
              
              <label
                htmlFor="student-file-upload"
                className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-muted-foreground/25 rounded-lg cursor-pointer hover:border-primary/50 transition-colors bg-muted/20"
              >
                {convertingHeic && isStudentExtracting ? (
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
            {studentFiles.length > 0 && (
              <FileList
                files={studentFiles}
                setFiles={setStudentFiles}
                setCombinedText={setStudentCombinedText}
                label="Uploaded Files"
              />
            )}

            {/* Combined Extracted Text */}
            <div className="space-y-2">
              <Label htmlFor="extracted_text">
                Extracted Text (combined) {isStudentExtracting && '(Extracting...)'}
              </Label>
              <Textarea
                id="extracted_text"
                placeholder="Text extracted from files will appear here with page separators. You can also paste or type student work directly..."
                value={studentCombinedText}
                onChange={(e) => setStudentCombinedText(e.target.value)}
                rows={10}
                disabled={isStudentExtracting}
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
                  if (checked && studentCombinedText) {
                    setDetectedSourceCount(detectSourcesInText(studentCombinedText));
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
                {autoDetectSources && studentCombinedText.trim() && detectedSourceCount === 0 && !isStudentExtracting && (
                  <p className="text-xs text-muted-foreground/80">
                    No distinct source labels found — content will be graded as a single submission
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Section 2: Rubric / Grading Criteria */}
        <Card className="border-2 border-primary/30 shadow-lg bg-primary/5">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <span>Rubric / Grading Criteria</span>
              <span className="text-xs font-normal text-muted-foreground">Optional — required for scoring</span>
            </CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              Bottor uses your rubric to assign scores. If no rubric is provided, Bottor will still generate written feedback, but numeric scoring will be disabled.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            
            {/* Reuse Previous Rubric Section */}
            {savedRubrics.length > 0 && !form.rubric.trim() && (
              <div className="space-y-2 p-3 rounded-lg bg-muted/20 border border-muted-foreground/10">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <History className="w-4 h-4" />
                  <span>Reuse a previous rubric</span>
                </div>
                <Select onValueChange={handleSelectSavedRubric}>
                  <SelectTrigger className="w-full bg-background">
                    <SelectValue placeholder="Select a saved rubric..." />
                  </SelectTrigger>
                  <SelectContent className="bg-background border shadow-lg z-50">
                    {savedRubrics.map((rubric) => (
                      <SelectItem key={rubric.id} value={rubric.id}>
                        <div className="flex flex-col items-start">
                          <span className="font-medium">{rubric.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {formatRelativeTime(rubric.last_used_at)}
                            {rubric.subject && ` • ${rubric.subject}`}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Detected Rubric Suggestion */}
            {showDetectedRubricSuggestion && detectedRubricContent && !form.rubric.trim() && (
              <div className="p-3 rounded-lg bg-secondary/50 border border-secondary">
                <div className="flex items-start gap-2">
                  <BookOpen className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <p className="text-sm text-foreground">
                      Rubric detected from assignment — use this?
                    </p>
                    <div className="flex gap-2">
                      <Button 
                        size="sm" 
                        variant="default"
                        onClick={handleUseDetectedRubric}
                        className="h-7 text-xs"
                      >
                        Use
                      </Button>
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => {
                          updateForm('rubric', detectedRubricContent);
                          setShowDetectedRubricSuggestion(false);
                        }}
                        className="h-7 text-xs"
                      >
                        Edit
                      </Button>
                      <Button 
                        size="sm" 
                        variant="ghost"
                        onClick={() => setShowDetectedRubricSuggestion(false)}
                        className="h-7 text-xs text-muted-foreground"
                      >
                        Dismiss
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <Textarea
              id="rubric"
              placeholder="Paste your grading rubric here. Include criteria, point values, and expectations..."
              value={form.rubric}
              onChange={(e) => {
                updateForm('rubric', e.target.value);
                // Show save prompt when rubric is entered manually
                if (e.target.value.trim() && !showSaveRubricPrompt) {
                  setShowSaveRubricPrompt(true);
                }
              }}
              rows={6}
              className="font-mono text-sm"
            />

            {/* Save Rubric Prompt */}
            {showSaveRubricPrompt && form.rubric.trim() && (
              <div className="p-3 rounded-lg bg-muted/20 border border-muted-foreground/10 space-y-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Bookmark className="w-4 h-4" />
                  <span>Save this rubric for reuse?</span>
                  <span className="text-xs">(optional)</span>
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="Rubric name (optional)"
                    value={rubricNameInput}
                    onChange={(e) => setRubricNameInput(e.target.value)}
                    className="flex-1 h-8 text-sm"
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={handleSaveRubric}
                    disabled={savingRubric}
                    className="h-8"
                  >
                    {savingRubric ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <>
                        <Save className="w-3 h-3 mr-1" />
                        Save
                      </>
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowSaveRubricPrompt(false)}
                    className="h-8 text-muted-foreground"
                  >
                    Skip
                  </Button>
                </div>
              </div>
            )}
            
            {/* Rubric Status Callout */}
            {gradingMode === 'scoring' ? (
              <div className="space-y-2">
                <div className="flex flex-col gap-1 p-3 rounded-lg bg-primary/10 border border-primary/30">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-primary flex-shrink-0" />
                    <span className="text-sm font-medium text-primary">
                      {detectedRubricSource === 'Rubric textbox' 
                        ? 'Rubric detected — Scoring enabled'
                        : 'Rubric detected automatically — Scoring enabled'}
                    </span>
                  </div>
                  {detectedRubricSource && detectedRubricSource !== 'Rubric textbox' && (
                    <span className="text-xs text-muted-foreground ml-6">
                      Detected from {detectedRubricSource}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground ml-1">
                  You can edit, replace, or override the detected rubric at any time.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/30 border border-muted-foreground/20">
                  <Info className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <span className="text-sm text-muted-foreground">
                    No rubric detected — feedback-only mode enabled (no numeric score).
                  </span>
                </div>
                {/* Smart fallback hint */}
                {(form.answer_key.trim() || answerKeyCombinedText.trim()) && detectedContentType === 'objective' && (
                  <p className="text-xs text-muted-foreground ml-1 flex items-center gap-1">
                    <Info className="w-3 h-3" />
                    Answer key detected — will be used to evaluate objective questions.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Section 3: Answer Key (Optional - collapsed by default) */}
        <Collapsible open={answerKeyOpen} onOpenChange={setAnswerKeyOpen}>
          <Card className="border-0 shadow-md bg-card-gradient">
            <CollapsibleTrigger asChild>
              <CardHeader className="cursor-pointer hover:bg-muted/20 transition-colors rounded-t-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {answerKeyOpen ? (
                      <ChevronDown className="w-4 h-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    )}
                    <CardTitle className="text-lg">Answer Key (Optional)</CardTitle>
                  </div>
                  <Badge variant="outline" className="text-xs">Optional</Badge>
                </div>
                <CardDescription className="text-xs text-muted-foreground ml-6">
                  Optional reference for objective questions (e.g., math, multiple choice). Uploading an answer key can improve Bottor Assist accuracy.
                </CardDescription>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0 space-y-6">
                {/* A) Answer Key Text (paste, optional) */}
                <div className="space-y-2">
                  <Label htmlFor="answer_key">Answer Key (paste/type)</Label>
                  <Textarea
                    id="answer_key"
                    placeholder="e.g., 1. A, 2. B, 3. 42, 4. True..."
                    value={form.answer_key}
                    onChange={(e) => updateForm('answer_key', e.target.value)}
                    rows={4}
                    className="font-mono text-sm"
                  />
                </div>

                {/* B) Or upload answer key document */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label>Or upload answer key document</Label>
                    {answerKeyFiles.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => clearAllFiles(setAnswerKeyFiles, setAnswerKeyCombinedText, answerKeyFileInputRef)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        Clear all
                      </Button>
                    )}
                  </div>
                  
                  {/* Upload Zone */}
                  <div className="relative">
                    <input
                      ref={answerKeyFileInputRef}
                      type="file"
                      multiple
                      accept=".pdf,application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif"
                      onChange={handleAnswerKeyFileSelect}
                      className="hidden"
                      id="answer-key-file-upload"
                    />
                    
                    <label
                      htmlFor="answer-key-file-upload"
                      className="flex flex-col items-center justify-center w-full h-20 border-2 border-dashed border-muted-foreground/25 rounded-lg cursor-pointer hover:border-primary/50 transition-colors bg-muted/20"
                    >
                      {convertingHeic && isAnswerKeyExtracting ? (
                        <>
                          <Loader2 className="w-5 h-5 text-primary mb-1 animate-spin" />
                          <span className="text-sm text-muted-foreground">Converting HEIC...</span>
                        </>
                      ) : (
                        <>
                          <Upload className="w-5 h-5 text-muted-foreground mb-1" />
                          <span className="text-sm text-muted-foreground">
                            Upload answer key (PDF, image)
                          </span>
                        </>
                      )}
                    </label>
                  </div>

                  {/* Uploaded Files List */}
                  {answerKeyFiles.length > 0 && (
                    <FileList
                      files={answerKeyFiles}
                      setFiles={setAnswerKeyFiles}
                      setCombinedText={setAnswerKeyCombinedText}
                      label="Answer Key Documents"
                    />
                  )}

                  {/* Extracted Text for Answer Key */}
                  {answerKeyCombinedText && (
                    <div className="space-y-2">
                      <Label htmlFor="answer_key_extracted_text">
                        Extracted Answer Key Text {isAnswerKeyExtracting && '(Extracting...)'}
                      </Label>
                      <Textarea
                        id="answer_key_extracted_text"
                        value={answerKeyCombinedText}
                        onChange={(e) => setAnswerKeyCombinedText(e.target.value)}
                        rows={4}
                        disabled={isAnswerKeyExtracting}
                        className="font-mono text-sm"
                      />
                    </div>
                  )}
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Section 4: Assignment/Rubric Document Upload (Optional) */}
        <Card className="border-0 shadow-md bg-card-gradient">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                Upload Assignment / Rubric Document
                <Badge variant="outline" className="text-xs">Optional</Badge>
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground mt-1">
                Upload rubric or assignment directions (PDF/JPG/PNG). Optional.
              </CardDescription>
            </div>
            {assignmentFiles.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => clearAllFiles(setAssignmentFiles, setAssignmentCombinedText, assignmentFileInputRef)}
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
                ref={assignmentFileInputRef}
                type="file"
                multiple
                accept=".pdf,application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif"
                onChange={handleAssignmentFileSelect}
                className="hidden"
                id="assignment-file-upload"
              />
              
              <label
                htmlFor="assignment-file-upload"
                className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-muted-foreground/25 rounded-lg cursor-pointer hover:border-primary/50 transition-colors bg-muted/20"
              >
                {convertingHeic && isAssignmentExtracting ? (
                  <>
                    <Loader2 className="w-6 h-6 text-primary mb-2 animate-spin" />
                    <span className="text-sm text-muted-foreground">Converting HEIC...</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-5 h-5 text-muted-foreground mb-1" />
                    <span className="text-sm text-muted-foreground">
                      Upload rubric or assignment directions
                    </span>
                    <span className="text-xs text-muted-foreground">
                      PDF, JPG, PNG, HEIC/HEIF • Multiple files allowed
                    </span>
                  </>
                )}
              </label>
            </div>

            {/* Uploaded Files List */}
            {assignmentFiles.length > 0 && (
              <FileList
                files={assignmentFiles}
                setFiles={setAssignmentFiles}
                setCombinedText={setAssignmentCombinedText}
                label="Uploaded Documents"
              />
            )}

            {/* Combined Extracted Text for Assignment Docs */}
            {assignmentCombinedText && (
              <div className="space-y-2">
                <Label htmlFor="assignment_extracted_text">
                  Extracted Text {isAssignmentExtracting && '(Extracting...)'}
                </Label>
                <Textarea
                  id="assignment_extracted_text"
                  value={assignmentCombinedText}
                  onChange={(e) => setAssignmentCombinedText(e.target.value)}
                  rows={6}
                  disabled={isAssignmentExtracting}
                  className="font-mono text-sm"
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Section 5: Optional Context (collapsed by default - moved to bottom) */}
        <Collapsible open={optionalContextOpen} onOpenChange={setOptionalContextOpen}>
          <Card className="border-0 shadow-md bg-card-gradient">
            <CollapsibleTrigger asChild>
              <CardHeader className="cursor-pointer hover:bg-muted/20 transition-colors rounded-t-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {optionalContextOpen ? (
                      <ChevronDown className="w-4 h-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    )}
                    <CardTitle className="text-lg">Optional Context (Improves Feedback Quality)</CardTitle>
                  </div>
                  <Badge variant="outline" className="text-xs">Optional</Badge>
                </div>
                <CardDescription className="text-xs text-muted-foreground ml-6">
                  These fields are optional and help tailor feedback tone and language. They do not affect scoring rules.
                </CardDescription>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-4 pt-0">
                <div className="space-y-2">
                  <Label htmlFor="subject">Subject (optional)</Label>
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
                  <p className="text-xs text-muted-foreground">
                    Optional context to improve clarity of feedback.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="grade_level">Grade Level (optional)</Label>
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
                  <p className="text-xs text-muted-foreground">
                    Used only to adjust feedback language. Not required for scoring.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="assignment_type">Assignment Type (optional)</Label>
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
                  <p className="text-xs text-muted-foreground">
                    Helps format comments. Does not change scoring criteria.
                  </p>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Section 6: Generate Button (sticky at bottom) */}
        <div className="sticky bottom-4 z-10 bg-background/95 backdrop-blur-sm p-4 -mx-4 rounded-lg shadow-lg border border-border">
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
        </div>

        {/* Results (Editable) */}
        {result && (
          <div className="space-y-4 animate-fade-in">
            {/* Feedback-only mode notice */}
            {gradingMode === 'feedback-only' && (
              <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/30">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-destructive">
                      Score not generated — no grading criteria detected
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Provide rubric text or upload assignment rubric to enable scoring.
                    </p>
                  </div>
                </div>
              </div>
            )}

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
