/**
 * BulkUploadModal Component
 * 
 * Provides a drag-and-drop interface for bulk uploading student submissions.
 * Features:
 * - Drag & drop zone with file validation
 * - Document content extraction for student name detection
 * - File list with processing status indicators
 * - Manual student name assignment for undetected names
 * - Upload progress tracking
 */

import { useState, useCallback, useMemo } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Upload,
  FileText,
  Image,
  X,
  Check,
  AlertTriangle,
  Info,
  Loader2,
  User,
  Edit2,
  FileType,
  Clock,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

// Supported file types
const ACCEPTED_FILE_TYPES = {
  'application/pdf': ['.pdf'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'text/plain': ['.txt'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

type ProcessingStatus = 'pending' | 'extracting' | 'detected' | 'manual_needed' | 'error' | 'uploading' | 'success';

interface ParsedFile {
  id: string;
  file: File;
  extractedText: string;
  detectedName: string;
  editedName: string;
  isEditing: boolean;
  status: ProcessingStatus;
  statusMessage: string;
  errorMessage?: string;
}

interface BulkUploadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploadComplete: (files: File[]) => void;
}

/**
 * Detect student name from extracted document text (OCR)
 * Same logic as the main grading page
 */
function detectStudentNameFromText(text: string): { 
  name: string; 
  confidence: 'high' | 'low';
} {
  if (!text || !text.trim()) {
    return { name: '', confidence: 'low' };
  }

  // Look at first ~25 lines for name patterns
  const lines = text.split('\n').slice(0, 25);
  
  // Priority 1: Look for explicit "Name:" or "Student Name:" labels
  for (const line of lines) {
    const labelMatch = line.match(/(?:student\s*)?name\s*[:=]\s*(.+)/i);
    if (labelMatch) {
      const nameValue = labelMatch[1].trim();
      // Clean the name - stop at common metadata labels
      const stopWords = ['date', 'class', 'period', 'teacher', 'grade', 'subject'];
      let cleanedName = nameValue;
      for (const stopWord of stopWords) {
        const stopPattern = new RegExp(`\\b${stopWord}\\s*[:=]`, 'i');
        const stopMatch = cleanedName.match(stopPattern);
        if (stopMatch && stopMatch.index !== undefined) {
          cleanedName = cleanedName.substring(0, stopMatch.index).trim();
        }
      }
      
      const words = cleanedName.split(/\s+/);
      if (words.length >= 2 && words.length <= 4 && cleanedName.length >= 3 && cleanedName.length <= 50) {
        return { name: cleanedName, confidence: 'high' };
      }
    }
  }

  // Priority 2: Look for name at start of first content line
  const firstContentLine = lines.find(l => l.trim().length > 0);
  if (firstContentLine) {
    const startMatch = firstContentLine.match(/^([A-Z][a-z'-]*\s+[A-Z][a-z'-]*(?:\s+[A-Z][a-z'-]*)?)(?:\s|$)/);
    if (startMatch && startMatch[1]) {
      const words = startMatch[1].split(/\s+/);
      if (words.length >= 2 && words.length <= 4) {
        return { name: startMatch[1].trim(), confidence: 'high' };
      }
    }
  }

  // Priority 3: Look for "By: Name" or "Student: Name" patterns
  const byPatterns = [
    /student\s*[:=]\s*([A-Za-z][a-z'-]*(?:\s+[A-Za-z][a-z'-]*)+)/i,
    /by\s*[:=]?\s*([A-Za-z][a-z'-]*(?:\s+[A-Za-z][a-z'-]*)+)/i,
  ];
  
  for (const pattern of byPatterns) {
    const match = text.slice(0, 1000).match(pattern);
    if (match && match[1]) {
      const words = match[1].trim().split(/\s+/);
      if (words.length >= 2 && words.length <= 4) {
        return { name: match[1].trim(), confidence: 'low' };
      }
    }
  }

  return { name: '', confidence: 'low' };
}

/**
 * Get file type icon
 */
function getFileIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) {
    return <Image className="w-4 h-4 text-primary" />;
  }
  if (mimeType === 'application/pdf') {
    return <FileText className="w-4 h-4 text-destructive" />;
  }
  return <FileType className="w-4 h-4 text-muted-foreground" />;
}

/**
 * Get status icon and color
 */
function getStatusDisplay(status: ProcessingStatus): { icon: React.ReactNode; className: string } {
  switch (status) {
    case 'pending':
      return { icon: <Clock className="w-3 h-3" />, className: 'text-muted-foreground border-muted' };
    case 'extracting':
      return { icon: <Loader2 className="w-3 h-3 animate-spin" />, className: 'text-primary border-primary/30 bg-primary/5' };
    case 'detected':
      return { icon: <CheckCircle2 className="w-3 h-3" />, className: 'text-emerald-600 border-emerald-300 bg-emerald-50' };
    case 'manual_needed':
      return { icon: <AlertTriangle className="w-3 h-3" />, className: 'text-amber-600 border-amber-300 bg-amber-50' };
    case 'error':
      return { icon: <AlertCircle className="w-3 h-3" />, className: 'text-destructive border-destructive/30 bg-destructive/5' };
    case 'uploading':
      return { icon: <Loader2 className="w-3 h-3 animate-spin" />, className: 'text-primary border-primary/30 bg-primary/5' };
    case 'success':
      return { icon: <Check className="w-3 h-3" />, className: 'text-emerald-600 border-emerald-300 bg-emerald-50' };
    default:
      return { icon: <Clock className="w-3 h-3" />, className: 'text-muted-foreground border-muted' };
  }
}

/**
 * Format file size
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Convert file to base64
 */
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export function BulkUploadModal({
  open,
  onOpenChange,
  onUploadComplete,
}: BulkUploadModalProps) {
  const [parsedFiles, setParsedFiles] = useState<ParsedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Extract text from a file using the extract-text edge function
  const extractTextFromFile = useCallback(async (file: File): Promise<string> => {
    try {
      const base64 = await fileToBase64(file);
      const { data, error } = await supabase.functions.invoke('extract-text', {
        body: {
          file_data: base64,
          file_type: file.type,
          file_name: file.name,
        },
      });
      
      if (error) throw error;
      return data?.text || '';
    } catch (err) {
      console.error('Text extraction failed:', err);
      throw err;
    }
  }, []);

  // Process a single file - extract text and detect name
  const processFile = useCallback(async (fileId: string) => {
    const fileItem = parsedFiles.find(f => f.id === fileId);
    if (!fileItem) return;

    // Update status to extracting
    setParsedFiles(prev => prev.map(f => 
      f.id === fileId ? { ...f, status: 'extracting' as ProcessingStatus, statusMessage: 'Analyzing document...' } : f
    ));

    try {
      // Extract text from document
      const extractedText = await extractTextFromFile(fileItem.file);
      
      // Detect student name from content
      const { name, confidence } = detectStudentNameFromText(extractedText);
      
      if (name && confidence === 'high') {
        setParsedFiles(prev => prev.map(f => 
          f.id === fileId ? { 
            ...f, 
            extractedText,
            detectedName: name,
            editedName: name,
            status: 'detected' as ProcessingStatus, 
            statusMessage: `Matched: ${name}` 
          } : f
        ));
      } else if (name) {
        setParsedFiles(prev => prev.map(f => 
          f.id === fileId ? { 
            ...f, 
            extractedText,
            detectedName: name,
            editedName: name,
            status: 'manual_needed' as ProcessingStatus, 
            statusMessage: `Detected: ${name} (verify)` 
          } : f
        ));
      } else {
        setParsedFiles(prev => prev.map(f => 
          f.id === fileId ? { 
            ...f, 
            extractedText,
            status: 'manual_needed' as ProcessingStatus, 
            statusMessage: 'Name not detected' 
          } : f
        ));
      }
    } catch (err) {
      setParsedFiles(prev => prev.map(f => 
        f.id === fileId ? { 
          ...f, 
          status: 'error' as ProcessingStatus, 
          statusMessage: 'Extraction failed',
          errorMessage: err instanceof Error ? err.message : 'Unknown error'
        } : f
      ));
    }
  }, [parsedFiles, extractTextFromFile]);

  // Handle file drop
  const onDrop = useCallback((acceptedFiles: File[], rejectedFiles: any[]) => {
    // Process accepted files
    const newFiles: ParsedFile[] = acceptedFiles.map((file) => ({
      id: `${file.name}_${file.lastModified}_${Math.random().toString(36).substr(2, 9)}`,
      file,
      extractedText: '',
      detectedName: '',
      editedName: '',
      isEditing: false,
      status: 'pending' as ProcessingStatus,
      statusMessage: 'Waiting to process...',
    }));

    // Add to existing files (avoid duplicates by filename)
    setParsedFiles((prev) => {
      const existingNames = new Set(prev.map((f) => f.file.name));
      const uniqueNew = newFiles.filter((f) => !existingNames.has(f.file.name));
      return [...prev, ...uniqueNew];
    });

    // Start processing new files
    setTimeout(() => {
      newFiles.forEach(nf => {
        processFile(nf.id);
      });
    }, 100);

    if (rejectedFiles.length > 0) {
      console.warn('Rejected files:', rejectedFiles);
    }
  }, [processFile]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_FILE_TYPES,
    maxSize: MAX_FILE_SIZE,
    multiple: true,
  });

  // Remove file from list
  const removeFile = useCallback((fileId: string) => {
    setParsedFiles((prev) => prev.filter((f) => f.id !== fileId));
  }, []);

  // Toggle edit mode for student name
  const toggleEdit = useCallback((fileId: string) => {
    setParsedFiles((prev) =>
      prev.map((f) =>
        f.id === fileId ? { ...f, isEditing: !f.isEditing } : f
      )
    );
  }, []);

  // Update edited name
  const updateName = useCallback((fileId: string, newName: string) => {
    setParsedFiles((prev) =>
      prev.map((f) =>
        f.id === fileId ? { ...f, editedName: newName } : f
      )
    );
  }, []);

  // Confirm name edit
  const confirmEdit = useCallback((fileId: string) => {
    setParsedFiles((prev) =>
      prev.map((f) => {
        if (f.id === fileId) {
          const hasValidName = f.editedName.trim().length >= 2;
          return { 
            ...f, 
            isEditing: false, 
            status: hasValidName ? 'detected' as ProcessingStatus : 'manual_needed' as ProcessingStatus,
            statusMessage: hasValidName ? `Assigned: ${f.editedName}` : 'Name not assigned'
          };
        }
        return f;
      })
    );
  }, []);

  // Handle upload all
  const handleUploadAll = useCallback(async () => {
    if (parsedFiles.length === 0) return;

    setIsUploading(true);
    setUploadProgress(0);

    const totalFiles = parsedFiles.length;
    let completed = 0;

    // Mark all as uploading
    setParsedFiles((prev) =>
      prev.map((f) => ({ ...f, status: 'uploading' as ProcessingStatus, statusMessage: 'Uploading...' }))
    );

    // Process files with progress
    for (let i = 0; i < parsedFiles.length; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      completed++;
      setUploadProgress(Math.round((completed / totalFiles) * 100));
      
      setParsedFiles((prev) =>
        prev.map((f, idx) =>
          idx === i ? { ...f, status: 'success' as ProcessingStatus, statusMessage: 'Uploaded' } : f
        )
      );
    }

    // Complete upload - pass files to parent
    const filesToUpload = parsedFiles.map((pf) => pf.file);
    onUploadComplete(filesToUpload);

    // Show success state briefly
    await new Promise((resolve) => setTimeout(resolve, 500));
    
    // Close modal and reset
    setIsUploading(false);
    setParsedFiles([]);
    setUploadProgress(0);
    onOpenChange(false);
  }, [parsedFiles, onUploadComplete, onOpenChange]);

  // Cancel and reset
  const handleCancel = useCallback(() => {
    setParsedFiles([]);
    setUploadProgress(0);
    setIsUploading(false);
    onOpenChange(false);
  }, [onOpenChange]);

  // Stats
  const stats = useMemo(() => {
    const total = parsedFiles.length;
    const processing = parsedFiles.filter((f) => f.status === 'pending' || f.status === 'extracting').length;
    const detected = parsedFiles.filter((f) => f.status === 'detected').length;
    const needsReview = parsedFiles.filter((f) => f.status === 'manual_needed').length;
    const errors = parsedFiles.filter((f) => f.status === 'error').length;
    return { total, processing, detected, needsReview, errors };
  }, [parsedFiles]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5 text-primary" />
            Upload Student Submissions
          </DialogTitle>
          <DialogDescription>
            Upload multiple student documents at once. Student names will be automatically detected from document content.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden space-y-4">
          {/* Drop Zone */}
          <div
            {...getRootProps()}
            className={cn(
              'relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all',
              isDragActive
                ? 'border-primary bg-primary/5'
                : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30'
            )}
          >
            <input {...getInputProps()} />
            <div className="flex flex-col items-center gap-3">
              <div
                className={cn(
                  'w-14 h-14 rounded-full flex items-center justify-center transition-colors',
                  isDragActive ? 'bg-primary/10' : 'bg-muted'
                )}
              >
                <Upload
                  className={cn(
                    'w-7 h-7 transition-colors',
                    isDragActive ? 'text-primary' : 'text-muted-foreground'
                  )}
                />
              </div>
              <div>
                <p className="font-medium text-foreground">
                  {isDragActive ? 'Drop files here...' : 'Drag and drop files here, or click to browse'}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  PDF, DOCX, DOC, TXT, JPG, PNG • Max 10MB per file
                </p>
              </div>
            </div>
          </div>

          {/* Info Box */}
          <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50 border border-muted">
            <Info className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
            <div className="text-sm">
              <p className="font-medium text-foreground">Automatic Name Detection</p>
              <p className="text-muted-foreground">
                Any filename works — Bottor analyzes document content to find student names (same as regular uploads).
              </p>
            </div>
          </div>

          {/* File List */}
          {parsedFiles.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">
                  Files ({stats.total})
                </span>
                <div className="flex items-center gap-2 text-xs">
                  {stats.processing > 0 && (
                    <Badge variant="outline" className="text-primary border-primary/30">
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      {stats.processing} processing
                    </Badge>
                  )}
                  {stats.detected > 0 && (
                    <Badge variant="outline" className="text-emerald-600 border-emerald-300 bg-emerald-50">
                      {stats.detected} matched
                    </Badge>
                  )}
                  {stats.needsReview > 0 && (
                    <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50">
                      {stats.needsReview} needs review
                    </Badge>
                  )}
                </div>
              </div>

              <ScrollArea className="h-[240px] rounded-lg border">
                <div className="p-2 space-y-2">
                  {parsedFiles.map((pf) => {
                    const statusDisplay = getStatusDisplay(pf.status);
                    
                    return (
                      <div
                        key={pf.id}
                        className={cn(
                          'flex items-center gap-3 p-3 rounded-lg border transition-colors',
                          pf.status === 'success' || pf.status === 'detected'
                            ? 'bg-primary/5 border-primary/20'
                            : pf.status === 'error'
                            ? 'bg-destructive/5 border-destructive/20'
                            : pf.status === 'manual_needed'
                            ? 'bg-amber-50/50 border-amber-200'
                            : 'bg-background border-border'
                        )}
                      >
                        {/* File Icon */}
                        <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
                          {pf.status === 'extracting' || pf.status === 'uploading' ? (
                            <Loader2 className="w-4 h-4 animate-spin text-primary" />
                          ) : pf.status === 'success' ? (
                            <Check className="w-4 h-4 text-primary" />
                          ) : (
                            getFileIcon(pf.file.type)
                          )}
                        </div>

                        {/* File Info */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate" title={pf.file.name}>
                            {pf.file.name}
                          </p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>{formatFileSize(pf.file.size)}</span>
                            <span>•</span>
                            {pf.isEditing ? (
                              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                <User className="w-3 h-3" />
                                <Input
                                  value={pf.editedName}
                                  onChange={(e) => updateName(pf.id, e.target.value)}
                                  onKeyDown={(e) => e.key === 'Enter' && confirmEdit(pf.id)}
                                  onBlur={() => confirmEdit(pf.id)}
                                  placeholder="Enter student name..."
                                  className="h-5 text-xs px-1 w-32"
                                  autoFocus
                                />
                              </div>
                            ) : (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      onClick={() => toggleEdit(pf.id)}
                                      className="flex items-center gap-1 hover:text-foreground transition-colors"
                                      disabled={pf.status === 'pending' || pf.status === 'extracting'}
                                    >
                                      <User className="w-3 h-3" />
                                      <span className={pf.editedName ? '' : 'italic'}>
                                        {pf.editedName || (pf.status === 'extracting' ? 'Analyzing...' : 'Click to assign')}
                                      </span>
                                      {pf.editedName && <Edit2 className="w-3 h-3" />}
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent>Click to edit student name</TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                          </div>
                        </div>

                        {/* Status Badge */}
                        <Badge variant="outline" className={cn('text-xs gap-1', statusDisplay.className)}>
                          {statusDisplay.icon}
                          <span className="truncate max-w-[100px]">{pf.statusMessage}</span>
                        </Badge>

                        {/* Remove Button */}
                        {pf.status !== 'uploading' && pf.status !== 'success' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeFile(pf.id)}
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive flex-shrink-0"
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Upload Progress */}
          {isUploading && (
            <div className="space-y-2">
              <Progress value={uploadProgress} className="h-2" />
              <p className="text-center text-sm text-muted-foreground">
                Uploading... {uploadProgress}%
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 gap-2 sm:gap-0 pt-4 border-t">
          <Button variant="outline" onClick={handleCancel} disabled={isUploading}>
            Cancel
          </Button>
          <Button
            onClick={handleUploadAll}
            disabled={parsedFiles.length === 0 || isUploading || stats.processing > 0}
            className="gap-2"
          >
            {isUploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Uploading...
              </>
            ) : stats.processing > 0 ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Processing... ({stats.total - stats.processing}/{stats.total})
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                Upload All ({parsedFiles.length})
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
