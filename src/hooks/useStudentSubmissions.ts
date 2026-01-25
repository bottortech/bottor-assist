/**
 * Student Submissions Hook
 * 
 * Manages student work uploads grouped by student submission.
 * Each submission can contain multiple files (multi-page PDF or multiple images).
 * Files within a submission are graded together; different submissions are graded separately.
 */

import { useState, useCallback, useRef } from 'react';
import heic2any from 'heic2any';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export type FileStatus = 'queued' | 'uploading' | 'uploaded' | 'extracting' | 'ready' | 'failed';

export interface UploadedFileItem {
  id: string;
  file: File;
  originalFile?: File;
  fileName: string;
  mimeType: string;
  size: number;
  status: FileStatus;
  thumbnailUrl?: string;
  extractedText: string;
  error?: string;
  createdAt: Date;
}

export interface StudentSubmission {
  id: string;
  studentName: string;
  files: UploadedFileItem[];
  combinedText: string;
  createdAt: Date;
}

interface UseStudentSubmissionsOptions {
  maxConcurrentExtractions?: number;
  maxDimension?: number;
  jpegQuality?: number;
}

const DEFAULT_OPTIONS: Required<UseStudentSubmissionsOptions> = {
  maxConcurrentExtractions: 2,
  maxDimension: 1600,
  jpegQuality: 0.75,
};

export function useStudentSubmissions(options: UseStudentSubmissionsOptions = {}) {
  const { maxConcurrentExtractions, maxDimension, jpegQuality } = { ...DEFAULT_OPTIONS, ...options };
  const { toast } = useToast();
  
  const [submissions, setSubmissions] = useState<StudentSubmission[]>([]);
  
  // Track active extractions for concurrency control
  const activeExtractions = useRef(0);
  const extractionQueue = useRef<{ submissionId: string; fileId: string }[]>([]);

  /**
   * Generate unique ID
   */
  const generateId = useCallback((): string => {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }, []);

  /**
   * Generate unique ID for file
   */
  const getFileId = useCallback((file: File): string => {
    return `${file.name}_${file.lastModified}_${Math.random().toString(36).substr(2, 9)}`;
  }, []);

  /**
   * Generate thumbnail URL for image files
   */
  const generateThumbnail = useCallback((file: File): string | undefined => {
    if (file.type.startsWith('image/')) {
      return URL.createObjectURL(file);
    }
    return undefined;
  }, []);

  /**
   * Compress/resize image to max dimension with JPEG output
   */
  const compressImage = useCallback(async (blob: Blob): Promise<Blob> => {
    return new Promise((resolve, reject) => {
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
            jpegQuality
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
  }, [maxDimension, jpegQuality]);

  /**
   * Convert HEIC/HEIF to JPEG
   */
  const convertHeicToJpeg = useCallback(async (file: File): Promise<File> => {
    const converted = await heic2any({
      blob: file,
      toType: 'image/jpeg',
      quality: jpegQuality,
    });
    const blob = Array.isArray(converted) ? converted[0] : converted;
    const resized = await compressImage(blob);
    const newName = file.name.replace(/\.(heic|heif)$/i, '.jpg');
    return new File([resized], newName, { type: 'image/jpeg' });
  }, [compressImage, jpegQuality]);

  /**
   * Update combined text for a submission from its files
   */
  const updateSubmissionCombinedText = useCallback((submissionId: string) => {
    setSubmissions(prev => prev.map(sub => {
      if (sub.id !== submissionId) return sub;
      
      const parts = sub.files.map((uf, idx) => {
        const header = `--- Page ${idx + 1}: ${uf.fileName} ---`;
        let body: string;
        
        switch (uf.status) {
          case 'queued':
          case 'uploading':
          case 'uploaded':
            body = '[Waiting for extraction...]';
            break;
          case 'extracting':
            body = '[Extracting text...]';
            break;
          case 'ready':
            body = uf.extractedText || '[No text extracted]';
            break;
          case 'failed':
            body = `[Extraction failed${uf.error ? `: ${uf.error}` : ''} — paste text manually or retry]`;
            break;
          default:
            body = '[Unknown status]';
        }
        
        return `${header}\n${body}`;
      });
      
      return { ...sub, combinedText: parts.join('\n\n') };
    }));
  }, []);

  /**
   * Update file status within a submission
   */
  const updateFileStatus = useCallback((
    submissionId: string,
    fileId: string, 
    updates: Partial<UploadedFileItem>
  ) => {
    setSubmissions(prev => prev.map(sub => {
      if (sub.id !== submissionId) return sub;
      return {
        ...sub,
        files: sub.files.map(f => 
          f.id === fileId ? { ...f, ...updates } : f
        )
      };
    }));
    // Update combined text after file status change
    updateSubmissionCombinedText(submissionId);
  }, [updateSubmissionCombinedText]);

  /**
   * Convert file to base64
   */
  const fileToBase64 = useCallback((file: File): Promise<string> => {
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
  }, []);

  /**
   * Extract text from a single file
   */
  const extractTextFromFile = useCallback(async (file: File): Promise<string> => {
    const base64 = await fileToBase64(file);
    const { data, error } = await supabase.functions.invoke('extract-text', {
      body: {
        file_data: base64,
        file_type: file.type,
        file_name: file.name,
      },
    });
    if (error) throw error;
    return data.text || '';
  }, [fileToBase64]);

  /**
   * Process extraction queue with concurrency limiting
   */
  const processExtractionQueue = useCallback(async () => {
    while (
      extractionQueue.current.length > 0 && 
      activeExtractions.current < maxConcurrentExtractions
    ) {
      const item = extractionQueue.current.shift();
      if (!item) continue;
      
      const { submissionId, fileId } = item;
      activeExtractions.current++;
      
      // Get file from state
      setSubmissions(prev => {
        const submission = prev.find(s => s.id === submissionId);
        const fileItem = submission?.files.find(f => f.id === fileId);
        
        if (!fileItem || fileItem.status !== 'uploaded') {
          activeExtractions.current--;
          return prev;
        }
        
        // Start extraction in background
        (async () => {
          updateFileStatus(submissionId, fileId, { status: 'extracting' });
          
          try {
            const text = await extractTextFromFile(fileItem.file);
            updateFileStatus(submissionId, fileId, { 
              status: 'ready', 
              extractedText: text,
              error: undefined 
            });
          } catch (err) {
            console.error('Extraction failed for', fileItem.fileName, err);
            updateFileStatus(submissionId, fileId, { 
              status: 'failed',
              error: err instanceof Error ? err.message : 'Unknown error'
            });
          } finally {
            activeExtractions.current--;
            processExtractionQueue();
          }
        })();
        
        return prev;
      });
    }
  }, [maxConcurrentExtractions, extractTextFromFile, updateFileStatus]);

  /**
   * Queue file for extraction
   */
  const queueExtraction = useCallback((submissionId: string, fileId: string) => {
    extractionQueue.current.push({ submissionId, fileId });
    processExtractionQueue();
  }, [processExtractionQueue]);

  /**
   * Retry extraction for a failed file
   */
  const retryExtraction = useCallback((submissionId: string, fileId: string) => {
    setSubmissions(prev => prev.map(sub => {
      if (sub.id !== submissionId) return sub;
      return {
        ...sub,
        files: sub.files.map(f => 
          f.id === fileId ? { ...f, status: 'uploaded' as FileStatus, error: undefined } : f
        )
      };
    }));
    queueExtraction(submissionId, fileId);
    toast({ title: 'Retrying extraction...' });
  }, [queueExtraction, toast]);

  /**
   * Create a new student submission with files
   */
  const createSubmission = useCallback(async (selectedFiles: FileList | File[], studentName?: string) => {
    const allowedMimes = [
      'application/pdf',
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'image/heic',
      'image/heif',
    ];

    const newFileItems: UploadedFileItem[] = [];
    const errors: string[] = [];

    for (const selectedFile of Array.from(selectedFiles)) {
      const fileType = (selectedFile.type || '').toLowerCase();
      const ext = selectedFile.name.split('.').pop()?.toLowerCase();
      const okByExt = !!ext && ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'].includes(ext);
      const okByMime = allowedMimes.includes(fileType);

      if (!okByExt && !okByMime) {
        errors.push(`Skipped ${selectedFile.name}: Unsupported file type`);
        continue;
      }

      if (selectedFile.size > 10 * 1024 * 1024) {
        errors.push(`Skipped ${selectedFile.name}: File too large (max 10MB)`);
        continue;
      }

      const isHeicOrHeif = 
        fileType === 'image/heic' || 
        fileType === 'image/heif' ||
        ext === 'heic' || 
        ext === 'heif';

      const id = getFileId(selectedFile);
      const thumbnailUrl = !isHeicOrHeif ? generateThumbnail(selectedFile) : undefined;
      
      const fileItem: UploadedFileItem = {
        id,
        file: selectedFile,
        originalFile: isHeicOrHeif ? selectedFile : undefined,
        fileName: selectedFile.name,
        mimeType: selectedFile.type,
        size: selectedFile.size,
        status: 'queued',
        thumbnailUrl,
        extractedText: '',
        createdAt: new Date(),
      };
      
      newFileItems.push(fileItem);
    }

    if (errors.length > 0) {
      toast({
        title: 'Some files were skipped',
        description: errors.join('. '),
        variant: 'destructive',
      });
    }

    if (newFileItems.length === 0) return null;

    // Create new submission
    const submissionId = generateId();
    const submissionNumber = submissions.length + 1;
    const defaultName = studentName || `Student ${submissionNumber}`;
    
    const newSubmission: StudentSubmission = {
      id: submissionId,
      studentName: defaultName,
      files: newFileItems,
      combinedText: '',
      createdAt: new Date(),
    };

    setSubmissions(prev => [...prev, newSubmission]);
    updateSubmissionCombinedText(submissionId);

    toast({ title: `Submission created with ${newFileItems.length} file(s)` });

    // Process each file asynchronously
    for (const fileItem of newFileItems) {
      processFile(submissionId, fileItem);
    }

    return submissionId;
  }, [submissions.length, generateId, getFileId, generateThumbnail, toast, updateSubmissionCombinedText]);

  /**
   * Process a single file (conversion, compression, queue for extraction)
   */
  const processFile = useCallback(async (submissionId: string, fileItem: UploadedFileItem) => {
    try {
      let processedFile = fileItem.file;
      const ext = fileItem.fileName.split('.').pop()?.toLowerCase();
      const isHeicOrHeif = 
        fileItem.mimeType === 'image/heic' || 
        fileItem.mimeType === 'image/heif' ||
        ext === 'heic' || 
        ext === 'heif';

      updateFileStatus(submissionId, fileItem.id, { status: 'uploading' });

      if (isHeicOrHeif) {
        try {
          processedFile = await convertHeicToJpeg(fileItem.file);
          const newThumbnail = generateThumbnail(processedFile);
          updateFileStatus(submissionId, fileItem.id, {
            file: processedFile,
            fileName: processedFile.name,
            mimeType: processedFile.type,
            size: processedFile.size,
            thumbnailUrl: newThumbnail,
          });
        } catch (err) {
          console.error('HEIC conversion failed:', err);
          updateFileStatus(submissionId, fileItem.id, {
            status: 'failed',
            error: 'HEIC conversion failed. Try uploading as JPG/PNG.',
          });
          return;
        }
      } else if (processedFile.type.startsWith('image/') && processedFile.type !== 'application/pdf') {
        try {
          const compressed = await compressImage(processedFile);
          processedFile = new File([compressed], processedFile.name, { type: 'image/jpeg' });
          updateFileStatus(submissionId, fileItem.id, {
            file: processedFile,
            size: processedFile.size,
          });
        } catch (err) {
          console.warn('Image compression failed, using original:', err);
        }
      }

      updateFileStatus(submissionId, fileItem.id, { status: 'uploaded' });
      queueExtraction(submissionId, fileItem.id);
      
    } catch (err) {
      console.error('File processing failed:', err);
      updateFileStatus(submissionId, fileItem.id, {
        status: 'failed',
        error: err instanceof Error ? err.message : 'Processing failed',
      });
    }
  }, [convertHeicToJpeg, compressImage, generateThumbnail, updateFileStatus, queueExtraction]);

  /**
   * Add files to an existing submission
   */
  const addFilesToSubmission = useCallback(async (submissionId: string, selectedFiles: FileList | File[]) => {
    const allowedMimes = [
      'application/pdf',
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'image/heic',
      'image/heif',
    ];

    const newFileItems: UploadedFileItem[] = [];
    const errors: string[] = [];

    for (const selectedFile of Array.from(selectedFiles)) {
      const fileType = (selectedFile.type || '').toLowerCase();
      const ext = selectedFile.name.split('.').pop()?.toLowerCase();
      const okByExt = !!ext && ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'].includes(ext);
      const okByMime = allowedMimes.includes(fileType);

      if (!okByExt && !okByMime) {
        errors.push(`Skipped ${selectedFile.name}: Unsupported file type`);
        continue;
      }

      if (selectedFile.size > 10 * 1024 * 1024) {
        errors.push(`Skipped ${selectedFile.name}: File too large (max 10MB)`);
        continue;
      }

      const isHeicOrHeif = 
        fileType === 'image/heic' || 
        fileType === 'image/heif' ||
        ext === 'heic' || 
        ext === 'heif';

      const id = getFileId(selectedFile);
      const thumbnailUrl = !isHeicOrHeif ? generateThumbnail(selectedFile) : undefined;
      
      const fileItem: UploadedFileItem = {
        id,
        file: selectedFile,
        originalFile: isHeicOrHeif ? selectedFile : undefined,
        fileName: selectedFile.name,
        mimeType: selectedFile.type,
        size: selectedFile.size,
        status: 'queued',
        thumbnailUrl,
        extractedText: '',
        createdAt: new Date(),
      };
      
      newFileItems.push(fileItem);
    }

    if (errors.length > 0) {
      toast({
        title: 'Some files were skipped',
        description: errors.join('. '),
        variant: 'destructive',
      });
    }

    if (newFileItems.length === 0) return;

    setSubmissions(prev => prev.map(sub => {
      if (sub.id !== submissionId) return sub;
      return { ...sub, files: [...sub.files, ...newFileItems] };
    }));
    
    updateSubmissionCombinedText(submissionId);
    toast({ title: `${newFileItems.length} file(s) added to submission` });

    for (const fileItem of newFileItems) {
      processFile(submissionId, fileItem);
    }
  }, [getFileId, generateThumbnail, toast, updateSubmissionCombinedText, processFile]);

  /**
   * Rename a student submission
   */
  const renameSubmission = useCallback((submissionId: string, newName: string) => {
    setSubmissions(prev => prev.map(sub => 
      sub.id === submissionId ? { ...sub, studentName: newName } : sub
    ));
  }, []);

  /**
   * Move a file from one submission to another
   */
  const moveFileBetweenSubmissions = useCallback((
    fromSubmissionId: string, 
    toSubmissionId: string, 
    fileId: string
  ) => {
    setSubmissions(prev => {
      const fromSubmission = prev.find(s => s.id === fromSubmissionId);
      const fileToMove = fromSubmission?.files.find(f => f.id === fileId);
      
      if (!fileToMove) return prev;

      return prev.map(sub => {
        if (sub.id === fromSubmissionId) {
          return { ...sub, files: sub.files.filter(f => f.id !== fileId) };
        }
        if (sub.id === toSubmissionId) {
          return { ...sub, files: [...sub.files, fileToMove] };
        }
        return sub;
      });
    });

    updateSubmissionCombinedText(fromSubmissionId);
    updateSubmissionCombinedText(toSubmissionId);
    toast({ title: 'File moved to another submission' });
  }, [updateSubmissionCombinedText, toast]);

  /**
   * Remove a file from a submission
   */
  const removeFile = useCallback((submissionId: string, fileId: string) => {
    setSubmissions(prev => prev.map(sub => {
      if (sub.id !== submissionId) return sub;
      
      const fileToRemove = sub.files.find(f => f.id === fileId);
      if (fileToRemove?.thumbnailUrl) {
        URL.revokeObjectURL(fileToRemove.thumbnailUrl);
      }
      
      return { ...sub, files: sub.files.filter(f => f.id !== fileId) };
    }));
    updateSubmissionCombinedText(submissionId);
  }, [updateSubmissionCombinedText]);

  /**
   * Delete an entire submission
   */
  const deleteSubmission = useCallback((submissionId: string) => {
    setSubmissions(prev => {
      const submission = prev.find(s => s.id === submissionId);
      submission?.files.forEach(f => {
        if (f.thumbnailUrl) URL.revokeObjectURL(f.thumbnailUrl);
      });
      return prev.filter(s => s.id !== submissionId);
    });
    toast({ title: 'Submission removed' });
  }, [toast]);

  /**
   * Update combined text manually for a submission
   */
  const setSubmissionCombinedText = useCallback((submissionId: string, text: string) => {
    setSubmissions(prev => prev.map(sub => 
      sub.id === submissionId ? { ...sub, combinedText: text } : sub
    ));
  }, []);

  /**
   * Clear all submissions
   */
  const clearAllSubmissions = useCallback(() => {
    setSubmissions(prev => {
      prev.forEach(sub => {
        sub.files.forEach(f => {
          if (f.thumbnailUrl) URL.revokeObjectURL(f.thumbnailUrl);
        });
      });
      return [];
    });
    extractionQueue.current = [];
  }, []);

  // Calculate statistics
  const totalSubmissions = submissions.length;
  const totalFiles = submissions.reduce((acc, sub) => acc + sub.files.length, 0);
  const completedFiles = submissions.reduce((acc, sub) => 
    acc + sub.files.filter(f => f.status === 'ready').length, 0
  );
  const failedFiles = submissions.reduce((acc, sub) => 
    acc + sub.files.filter(f => f.status === 'failed').length, 0
  );
  const isExtracting = submissions.some(sub => 
    sub.files.some(f => 
      f.status === 'queued' || 
      f.status === 'uploading' || 
      f.status === 'uploaded' || 
      f.status === 'extracting'
    )
  );
  const hasReadySubmissions = submissions.some(sub => 
    sub.files.some(f => f.status === 'ready')
  );
  const progress = totalFiles > 0 ? (completedFiles / totalFiles) * 100 : 0;

  return {
    submissions,
    createSubmission,
    addFilesToSubmission,
    renameSubmission,
    moveFileBetweenSubmissions,
    removeFile,
    deleteSubmission,
    retryExtraction,
    setSubmissionCombinedText,
    clearAllSubmissions,
    totalSubmissions,
    totalFiles,
    completedFiles,
    failedFiles,
    isExtracting,
    hasReadySubmissions,
    progress,
  };
}
