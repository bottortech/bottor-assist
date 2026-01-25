/**
 * Optimistic File Upload Hook (v2 - Resilient Non-Blocking Pipeline)
 * 
 * Handles file uploads with:
 * - Immediate display with status chips (Queued, Uploading, Extracting, Ready, Failed)
 * - Client-side thumbnail generation
 * - Image compression/resize before upload
 * - HEIC to JPEG conversion
 * - Background extraction with concurrency limiting (max 2-3 concurrent)
 * - 15-second timeout guard for extraction prevents indefinite hangs
 * - Combined text streaming as files complete
 * - Retry functionality for failed extractions
 * - Watchdog to auto-fail stuck extractions
 * 
 * isExtracting is DERIVED from file statuses, never manually set.
 */

import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import heic2any from 'heic2any';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export type FileStatus = 'queued' | 'uploading' | 'uploaded' | 'extracting' | 'ready' | 'failed';

// Helper to check if a status is "processing"
const isProcessingStatus = (status: FileStatus): boolean => 
  ['queued', 'uploading', 'uploaded', 'extracting'].includes(status);

// Extraction timeout in milliseconds (15 seconds for pilot demo)
const EXTRACTION_TIMEOUT_MS = 15000;

export interface UploadedFileItem {
  id: string;
  file: File;
  originalFile?: File; // Original file before conversion
  fileName: string;
  mimeType: string;
  size: number;
  status: FileStatus;
  thumbnailUrl?: string;
  extractedText: string;
  error?: string;
  errorMessage?: string; // Alias for error
  extractionStartedAt?: number; // Timestamp when extraction started
  createdAt: Date;
}

interface UseFileUploadOptions {
  maxConcurrentExtractions?: number;
  maxDimension?: number;
  jpegQuality?: number;
  extractionTimeoutMs?: number;
}

const DEFAULT_OPTIONS: Required<UseFileUploadOptions> = {
  maxConcurrentExtractions: 2,
  maxDimension: 1600,
  jpegQuality: 0.75,
  extractionTimeoutMs: EXTRACTION_TIMEOUT_MS,
};

export function useFileUpload(options: UseFileUploadOptions = {}) {
  const { maxConcurrentExtractions, maxDimension, jpegQuality, extractionTimeoutMs } = { ...DEFAULT_OPTIONS, ...options };
  const { toast } = useToast();
  
  const [files, setFiles] = useState<UploadedFileItem[]>([]);
  const [combinedText, setCombinedText] = useState('');
  
  // Track active extractions for concurrency control
  const activeExtractions = useRef(0);
  const extractionQueue = useRef<string[]>([]);

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
   * Compute combined text from files
   * This is a pure function, no side effects
   */
  const computeCombinedText = useCallback((fileList: UploadedFileItem[]): string => {
    const parts = fileList.map((uf, idx) => {
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
    
    return parts.join('\n\n');
  }, []);

  /**
   * Effect to update combined text whenever files change
   * This replaces manual calls to updateCombinedText inside state setters
   */
  useEffect(() => {
    setCombinedText(computeCombinedText(files));
  }, [files, computeCombinedText]);

  /**
   * Update file status - simplified, no nested state updates
   */
  const updateFileStatus = useCallback((
    fileId: string, 
    updates: Partial<UploadedFileItem>
  ) => {
    setFiles(prev => prev.map(f => 
      f.id === fileId ? { ...f, ...updates } : f
    ));
    // Combined text will update automatically via useEffect
  }, []);

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
   * Extract text from a single file with timeout guard
   * Returns a result object to ensure we never throw unhandled
   */
  const extractTextFromFile = useCallback(async (
    file: File
  ): Promise<{ success: true; text: string } | { success: false; error: string }> => {
    try {
      const base64 = await fileToBase64(file);
      
      // Create a timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Timed out — skipped for pilot demo')), extractionTimeoutMs);
      });
      
      // Race between extraction and timeout
      const extractionPromise = supabase.functions.invoke('extract-text', {
        body: {
          file_data: base64,
          file_type: file.type,
          file_name: file.name,
        },
      });
      
      const { data, error } = await Promise.race([extractionPromise, timeoutPromise]);
      
      if (error) {
        return { success: false, error: error.message || 'Extraction failed' };
      }
      
      return { success: true, text: data?.text || '' };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error('Extraction error:', errorMessage);
      return { success: false, error: errorMessage };
    }
  }, [fileToBase64, extractionTimeoutMs]);

  /**
   * Process a single extraction - returns promise that ALWAYS resolves (never rejects)
   * This ensures one failure never blocks other extractions
   */
  const processExtraction = useCallback(async (fileId: string): Promise<{ fileId: string; success: boolean; error?: string }> => {
    // Get file data synchronously
    let fileItem: UploadedFileItem | undefined;
    setFiles(prev => {
      fileItem = prev.find(f => f.id === fileId);
      return prev;
    });
    
    // Skip if not found or not ready for extraction
    if (!fileItem || fileItem.status !== 'uploaded') {
      return { fileId, success: false, error: 'File not ready for extraction' };
    }
    
    // Update to extracting with timestamp
    updateFileStatus(fileId, { 
      status: 'extracting', 
      extractionStartedAt: Date.now(),
      error: undefined,
      errorMessage: undefined,
    });
    
    // Perform extraction with built-in timeout
    const result = await extractTextFromFile(fileItem.file);
    
    if (result.success) {
      updateFileStatus(fileId, { 
        status: 'ready', 
        extractedText: result.text,
        error: undefined,
        errorMessage: undefined,
        extractionStartedAt: undefined,
      });
      return { fileId, success: true };
    } else {
      const errorMessage = 'error' in result ? result.error : 'Unknown extraction error';
      console.error('Extraction failed for', fileItem.fileName, errorMessage);
      updateFileStatus(fileId, { 
        status: 'failed',
        error: errorMessage,
        errorMessage: errorMessage,
        extractionStartedAt: undefined,
      });
      return { fileId, success: false, error: errorMessage };
    }
  }, [extractTextFromFile, updateFileStatus]);

  /**
   * Process extraction queue with concurrency limiting
   * Uses Promise.allSettled to ensure one failure doesn't block others
   * Each extraction call ALWAYS resolves (never rejects)
   */
  const processExtractionQueue = useCallback(async () => {
    const filesToExtract: string[] = [];
    
    while (
      extractionQueue.current.length > 0 && 
      activeExtractions.current + filesToExtract.length < maxConcurrentExtractions
    ) {
      const fileId = extractionQueue.current.shift();
      if (fileId) {
        filesToExtract.push(fileId);
        activeExtractions.current++;
      }
    }
    
    if (filesToExtract.length === 0) return;
    
    // Process all concurrently with Promise.allSettled
    // Each processExtraction already handles its own errors and always resolves
    const results = await Promise.allSettled(
      filesToExtract.map(fileId => processExtraction(fileId))
    );
    
    // Log any unexpected rejections and decrease active count
    results.forEach((result, idx) => {
      activeExtractions.current = Math.max(0, activeExtractions.current - 1);
      if (result.status === 'rejected') {
        console.error('Unexpected extraction rejection:', result.reason);
      }
    });
    
    // Continue processing queue if there are more items
    if (extractionQueue.current.length > 0) {
      // Use setTimeout to prevent stack overflow on large queues
      setTimeout(() => processExtractionQueue(), 10);
    }
  }, [maxConcurrentExtractions, processExtraction]);

  /**
   * Queue file for extraction
   */
  const queueExtraction = useCallback((fileId: string) => {
    extractionQueue.current.push(fileId);
    processExtractionQueue();
  }, [processExtractionQueue]);

  /**
   * Retry extraction for a failed file
   */
  const retryExtraction = useCallback((fileId: string) => {
    setFiles(prev => prev.map(f => 
      f.id === fileId ? { ...f, status: 'uploaded' as FileStatus, error: undefined } : f
    ));
    // Combined text will update automatically via useEffect
    queueExtraction(fileId);
    toast({ title: 'Retrying extraction...' });
  }, [queueExtraction, toast]);

  /**
   * Add files to the upload list
   */
  const addFiles = useCallback(async (selectedFiles: FileList | File[]) => {
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
      
      // Create initial file item with queued status
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

    // Show errors if any
    if (errors.length > 0) {
      toast({
        title: 'Some files were skipped',
        description: errors.join('. '),
        variant: 'destructive',
      });
    }

    if (newFileItems.length === 0) return;

    // Add files immediately to state (optimistic)
    // Combined text will update automatically via useEffect
    setFiles(prev => [...prev, ...newFileItems]);

    toast({ title: `${newFileItems.length} file(s) added` });

    // Process each file asynchronously
    for (const fileItem of newFileItems) {
      (async () => {
        try {
          let processedFile = fileItem.file;
          const ext = fileItem.fileName.split('.').pop()?.toLowerCase();
          const isHeicOrHeif = 
            fileItem.mimeType === 'image/heic' || 
            fileItem.mimeType === 'image/heif' ||
            ext === 'heic' || 
            ext === 'heif';

          // Update status to uploading
          updateFileStatus(fileItem.id, { status: 'uploading' });

          // Convert HEIC if needed
          if (isHeicOrHeif) {
            try {
              processedFile = await convertHeicToJpeg(fileItem.file);
              // Update with new file and thumbnail
              const newThumbnail = generateThumbnail(processedFile);
              updateFileStatus(fileItem.id, {
                file: processedFile,
                fileName: processedFile.name,
                mimeType: processedFile.type,
                size: processedFile.size,
                thumbnailUrl: newThumbnail,
              });
            } catch (err) {
              console.error('HEIC conversion failed:', err);
              updateFileStatus(fileItem.id, {
                status: 'failed',
                error: 'HEIC conversion failed. Try uploading as JPG/PNG.',
              });
              return; // Exit this file's processing
            }
          } else if (processedFile.type.startsWith('image/') && processedFile.type !== 'application/pdf') {
            // Compress images
            try {
              const compressed = await compressImage(processedFile);
              processedFile = new File([compressed], processedFile.name, { type: 'image/jpeg' });
              updateFileStatus(fileItem.id, {
                file: processedFile,
                size: processedFile.size,
              });
            } catch (err) {
              console.warn('Image compression failed, using original:', err);
            }
          }

          // Mark as uploaded (ready for extraction)
          updateFileStatus(fileItem.id, { status: 'uploaded' });
          
          // Queue for extraction
          queueExtraction(fileItem.id);
          
        } catch (err) {
          console.error('File processing failed:', err);
          updateFileStatus(fileItem.id, {
            status: 'failed',
            error: err instanceof Error ? err.message : 'Processing failed',
          });
        }
      })();
    }
  }, [
    getFileId, 
    generateThumbnail, 
    convertHeicToJpeg, 
    compressImage,
    updateFileStatus, 
    queueExtraction,
    toast
  ]);

  /**
   * Remove a single file
   */
  const removeFile = useCallback((fileId: string) => {
    setFiles(prev => {
      const fileToRemove = prev.find(f => f.id === fileId);
      if (fileToRemove?.thumbnailUrl) {
        URL.revokeObjectURL(fileToRemove.thumbnailUrl);
      }
      return prev.filter(f => f.id !== fileId);
      // Combined text will update automatically via useEffect
    });
  }, []);

  /**
   * Clear all files
   */
  const clearAllFiles = useCallback(() => {
    setFiles(prev => {
      prev.forEach(f => {
        if (f.thumbnailUrl) {
          URL.revokeObjectURL(f.thumbnailUrl);
        }
      });
      return [];
    });
    setCombinedText('');
    extractionQueue.current = [];
  }, []);

  /**
   * Set combined text manually (for user edits)
   */
  const setCombinedTextManual = useCallback((text: string) => {
    setCombinedText(text);
  }, []);

  /**
   * Watchdog effect: Auto-fail extractions stuck longer than timeout
   * Runs every 5 seconds to check for stuck files
   */
  useEffect(() => {
    const watchdogInterval = setInterval(() => {
      const now = Date.now();
      
      setFiles(prev => {
        const hasStuck = prev.some(f => 
          f.status === 'extracting' && 
          f.extractionStartedAt && 
          (now - f.extractionStartedAt) > extractionTimeoutMs
        );
        
        if (!hasStuck) return prev;
        
        return prev.map(f => {
          if (
            f.status === 'extracting' && 
            f.extractionStartedAt && 
            (now - f.extractionStartedAt) > extractionTimeoutMs
          ) {
            console.warn('Watchdog: Auto-failing stuck extraction for', f.fileName);
            return {
              ...f,
              status: 'failed' as FileStatus,
              error: 'Extraction timed out - please retry',
              errorMessage: 'Extraction timed out - please retry',
              extractionStartedAt: undefined,
            };
          }
          return f;
        });
        // Combined text will update automatically via useEffect on files change
      });
    }, 5000); // Check every 5 seconds
    
    return () => clearInterval(watchdogInterval);
  }, [extractionTimeoutMs]);

  // Calculate statistics - DERIVED from file statuses
  const stats = useMemo(() => {
    const totalFiles = files.length;
    const completedFiles = files.filter(f => f.status === 'ready').length;
    const failedFiles = files.filter(f => f.status === 'failed').length;
    const isExtracting = files.some(f => isProcessingStatus(f.status));
    const hasReadyFiles = files.some(f => f.status === 'ready');
    const progress = totalFiles > 0 ? ((completedFiles + failedFiles) / totalFiles) * 100 : 0;
    
    return { totalFiles, completedFiles, failedFiles, isExtracting, hasReadyFiles, progress };
  }, [files]);

  return {
    files,
    combinedText,
    setCombinedText: setCombinedTextManual,
    addFiles,
    removeFile,
    clearAllFiles,
    retryExtraction,
    // Stats (derived)
    totalFiles: stats.totalFiles,
    completedFiles: stats.completedFiles,
    failedFiles: stats.failedFiles,
    isExtracting: stats.isExtracting,
    hasReadyFiles: stats.hasReadyFiles,
    progress: stats.progress,
  };
}
