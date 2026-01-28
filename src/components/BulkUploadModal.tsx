/**
 * BulkUploadModal Component
 * 
 * Provides a drag-and-drop interface for bulk uploading student submissions.
 * Features:
 * - Drag & drop zone with file validation
 * - Student name detection from filenames
 * - File list with status indicators
 * - Manual student name mapping
 * - Upload progress tracking
 */

import { useState, useCallback, useMemo } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
} from 'lucide-react';
import { cn } from '@/lib/utils';

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

interface ParsedFile {
  id: string;
  file: File;
  detectedName: string;
  editedName: string;
  isEditing: boolean;
  namingValid: boolean;
  status: 'pending' | 'uploading' | 'success' | 'error';
  errorMessage?: string;
}

interface BulkUploadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploadComplete: (files: File[]) => void;
}

/**
 * Parse student name from filename
 * Supports formats:
 * - StudentName_Assignment.pdf → "StudentName"
 * - FirstLast_Assignment.pdf → "First Last"
 * - First_Last_Assignment.pdf → "First Last"
 * - Last_First_Assignment.pdf → "Last First" (less common)
 */
function parseStudentNameFromFilename(filename: string): { name: string; isValid: boolean } {
  const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');
  
  // Pattern 1: CamelCase (JohnDoe, AliceJohnson)
  const camelCaseMatch = nameWithoutExt.match(/^([A-Z][a-z]+[A-Z][a-z]+)/);
  if (camelCaseMatch) {
    // Split camelCase into words
    const formatted = camelCaseMatch[1].replace(/([a-z])([A-Z])/g, '$1 $2');
    return { name: formatted, isValid: true };
  }
  
  // Pattern 2: Underscore separated (John_Doe, John_Doe_Assignment)
  const parts = nameWithoutExt.split(/[_\s]+/);
  if (parts.length >= 2) {
    // Check if first two parts look like names (start with capital)
    const firstName = parts[0];
    const secondPart = parts[1];
    
    if (/^[A-Za-z'-]+$/.test(firstName) && /^[A-Za-z'-]+$/.test(secondPart)) {
      // Capitalize first letters
      const formatPart = (p: string) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
      return { name: `${formatPart(firstName)} ${formatPart(secondPart)}`, isValid: true };
    }
  }
  
  // Pattern 3: Just the first part if it looks like a name
  if (parts[0] && /^[A-Za-z'-]+$/.test(parts[0]) && parts[0].length >= 2) {
    const formatted = parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase();
    return { name: formatted, isValid: false }; // Not ideal but usable
  }
  
  return { name: '', isValid: false };
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
 * Format file size
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function BulkUploadModal({
  open,
  onOpenChange,
  onUploadComplete,
}: BulkUploadModalProps) {
  const [parsedFiles, setParsedFiles] = useState<ParsedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Handle file drop
  const onDrop = useCallback((acceptedFiles: File[], rejectedFiles: any[]) => {
    // Process accepted files
    const newFiles: ParsedFile[] = acceptedFiles.map((file) => {
      const { name, isValid } = parseStudentNameFromFilename(file.name);
      return {
        id: `${file.name}_${file.lastModified}_${Math.random().toString(36).substr(2, 9)}`,
        file,
        detectedName: name,
        editedName: name,
        isEditing: false,
        namingValid: isValid,
        status: 'pending' as const,
      };
    });

    // Add to existing files (avoid duplicates by filename)
    setParsedFiles((prev) => {
      const existingNames = new Set(prev.map((f) => f.file.name));
      const uniqueNew = newFiles.filter((f) => !existingNames.has(f.file.name));
      return [...prev, ...uniqueNew];
    });

    // Show errors for rejected files
    if (rejectedFiles.length > 0) {
      console.warn('Rejected files:', rejectedFiles);
    }
  }, []);

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
        f.id === fileId
          ? {
              ...f,
              editedName: newName,
              namingValid: newName.trim().length >= 2,
            }
          : f
      )
    );
  }, []);

  // Confirm name edit
  const confirmEdit = useCallback((fileId: string) => {
    setParsedFiles((prev) =>
      prev.map((f) =>
        f.id === fileId ? { ...f, isEditing: false, namingValid: f.editedName.trim().length >= 2 } : f
      )
    );
  }, []);

  // Handle upload all
  const handleUploadAll = useCallback(async () => {
    if (parsedFiles.length === 0) return;

    setIsUploading(true);
    setUploadProgress(0);

    // Simulate upload progress (actual upload happens in parent)
    const totalFiles = parsedFiles.length;
    let completed = 0;

    // Mark all as uploading
    setParsedFiles((prev) =>
      prev.map((f) => ({ ...f, status: 'uploading' as const }))
    );

    // Process files with progress
    for (let i = 0; i < parsedFiles.length; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100)); // Small delay for visual feedback
      completed++;
      setUploadProgress(Math.round((completed / totalFiles) * 100));
      
      setParsedFiles((prev) =>
        prev.map((f, idx) =>
          idx === i ? { ...f, status: 'success' as const } : f
        )
      );
    }

    // Complete upload
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
    const valid = parsedFiles.filter((f) => f.namingValid).length;
    const needsReview = total - valid;
    return { total, valid, needsReview };
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
            Upload multiple student documents at once. Drag and drop or click to browse.
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

          {/* Naming Convention Help */}
          <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50 border border-muted">
            <Info className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
            <div className="text-sm">
              <p className="font-medium text-foreground">File Naming Convention</p>
              <p className="text-muted-foreground">
                Name files as <code className="bg-background px-1 rounded">StudentName_Assignment.pdf</code>
                <br />
                Examples: <code className="bg-background px-1 rounded">JohnDoe_Homework1.pdf</code>, <code className="bg-background px-1 rounded">Alice_Johnson_Essay.docx</code>
              </p>
            </div>
          </div>

          {/* File List */}
          {parsedFiles.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">
                  Files Selected ({stats.total})
                </span>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">
                    {stats.valid} valid naming
                  </span>
                  {stats.needsReview > 0 && (
                    <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50">
                      {stats.needsReview} needs review
                    </Badge>
                  )}
                </div>
              </div>

              <ScrollArea className="h-[240px] rounded-lg border">
                <div className="p-2 space-y-2">
                  {parsedFiles.map((pf) => (
                    <div
                      key={pf.id}
                      className={cn(
                        'flex items-center gap-3 p-3 rounded-lg border transition-colors',
                        pf.status === 'success'
                          ? 'bg-primary/5 border-primary/20'
                          : pf.namingValid
                          ? 'bg-background border-border'
                          : 'bg-amber-50/50 border-amber-200'
                      )}
                    >
                      {/* File Icon */}
                      <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
                        {pf.status === 'uploading' ? (
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
                            <div className="flex items-center gap-1">
                              <User className="w-3 h-3" />
                              <Input
                                value={pf.editedName}
                                onChange={(e) => updateName(pf.id, e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && confirmEdit(pf.id)}
                                onBlur={() => confirmEdit(pf.id)}
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
                                  >
                                    <User className="w-3 h-3" />
                                    <span className={pf.namingValid ? '' : 'text-amber-600'}>
                                      {pf.editedName || 'Unknown'}
                                    </span>
                                    <Edit2 className="w-3 h-3" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>Click to edit student name</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </div>
                      </div>

                      {/* Status/Actions */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {!pf.namingValid && pf.status === 'pending' && (
                          <Badge variant="outline" className="text-amber-600 border-amber-300 text-xs">
                            <AlertTriangle className="w-3 h-3 mr-1" />
                            Review
                          </Badge>
                        )}
                        {pf.namingValid && pf.status === 'pending' && (
                          <Badge variant="outline" className="text-primary border-primary/30 text-xs">
                            <Check className="w-3 h-3 mr-1" />
                            Valid
                          </Badge>
                        )}
                        {pf.status !== 'uploading' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeFile(pf.id)}
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
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

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleCancel} disabled={isUploading}>
            Cancel
          </Button>
          <Button
            onClick={handleUploadAll}
            disabled={parsedFiles.length === 0 || isUploading}
            className="gap-2"
          >
            {isUploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                Upload All ({parsedFiles.length})
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
