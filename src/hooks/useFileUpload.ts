/**
 * Optimistic File Upload Hook
 * 
 * Handles file uploads with:
 * - Immediate display with status chips (Queued, Uploading, Processing, Ready, Failed)
 * - Client-side thumbnail generation
 * - Image compression/resize before upload
 * - HEIC to JPEG conversion
 * - Background extraction with concurrency limiting (max 2-3 concurrent)
 * - Combined text streaming as files complete
 * - Retry functionality with exponential backoff
 * - Timeout watchdog to detect stalled uploads
 * - Duplicate filename handling
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import heic2any from 'heic2any';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export type FileStatus = 'queued' | 'uploading' | 'processing' | 'ready' | 'failed';

export interface UploadedFileItem {
  id: string;
  file: File;
  originalFile?: File; // Original file before conversion
  fileName: string;
  displayName: string; // Unique display name (handles duplicates)
  mimeType: string;
  size: number;
  status: FileStatus;
  statusMessage?: string; // Human-readable status detail
  thumbnailUrl?: string;
  extractedText: string;
  error?: string;
  createdAt: Date;
  lastActivityAt: Date; // Track last status change for watchdog
  retryCount: number; // Number of auto-retries attempted
}

interface UseFileUploadOptions {
  maxConcurrentExtractions?: number;
  maxDimension?: number;
  jpegQuality?: number;
  timeoutSeconds?: number;
  maxAutoRetries?: number;
}

const DEFAULT_OPTIONS: Required<UseFileUploadOptions> = {
  maxConcurrentExtractions: 2,
  maxDimension: 1600,
  jpegQuality: 0.75,
  timeoutSeconds: 45, // 45 second timeout
  maxAutoRetries: 1, // Auto-retry once before marking failed
};

export function useFileUpload(options: UseFileUploadOptions = {}) {
  const { 
    maxConcurrentExtractions, 
    maxDimension, 
    jpegQuality,
    timeoutSeconds,
    maxAutoRetries,
  } = { ...DEFAULT_OPTIONS, ...options };
  
  const { toast } = useToast();
  
  const [files, setFiles] = useState<UploadedFileItem[]>([]);
  const [combinedText, setCombinedText] = useState('');
  
  // Track active extractions for concurrency control
  const activeExtractions = useRef(0);
  const extractionQueue = useRef<string[]>([]);
  
  // Track used filenames for deduplication
  const usedFilenames = useRef<Map<string, number>>(new Map());
  
  // Watchdog interval ref
  const watchdogInterval = useRef<number | null>(null);

  /**
   * Generate unique ID for file
   */
  const getFileId = useCallback((file: File): string => {
    return `${file.name}_${file.lastModified}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }, []);

  /**
   * Generate unique display name (handles duplicates)
   */
  const getUniqueDisplayName = useCallback((fileName: string): string => {
    const count = usedFilenames.current.get(fileName) || 0;
    usedFilenames.current.set(fileName, count + 1);
    
    if (count === 0) {
      return fileName;
    }
    
    // Add suffix for duplicates
    const ext = fileName.includes('.') ? '.' + fileName.split('.').pop() : '';
    const baseName = fileName.replace(/\.[^/.]+$/, '');
    return `${baseName} (${count + 1})${ext}`;
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
      
      // Add timeout for image loading
      const loadTimeout = setTimeout(() => {
        URL.revokeObjectURL(url);
        reject(new Error('Image load timeout'));
      }, 30000);
      
      img.onload = () => {
        clearTimeout(loadTimeout);
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
        clearTimeout(loadTimeout);
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
   * Update combined text from all files
   */
  const updateCombinedText = useCallback((fileList: UploadedFileItem[]) => {
    const parts = fileList.map((uf, idx) => {
      const header = `--- Page ${idx + 1}: ${uf.displayName} ---`;
      let body: string;
      
      switch (uf.status) {
        case 'queued':
          body = '[Waiting in queue...]';
          break;
        case 'uploading':
          body = '[Uploading...]';
          break;
        case 'processing':
          body = '[Extracting text...]';
          break;
        case 'ready':
          body = uf.extractedText || '[No text extracted]';
          break;
        case 'failed':
          body = `[Extraction failed${uf.error ? `: ${uf.error}` : ''} — tap Retry]`;
          break;
        default:
          body = '[Unknown status]';
      }
      
      return `${header}\n${body}`;
    });
    
    setCombinedText(parts.join('\n\n'));
  }, []);

  /**
   * Update file status with activity timestamp
   */
  const updateFileStatus = useCallback((
    fileId: string, 
    updates: Partial<UploadedFileItem>
  ) => {
    setFiles(prev => {
      const updated = prev.map(f => 
        f.id === fileId 
          ? { ...f, ...updates, lastActivityAt: new Date() } 
          : f
      );
      updateCombinedText(updated);
      return updated;
    });
  }, [updateCombinedText]);

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
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }, []);

  /**
   * Extract text from a single file with timeout
   */
  const extractTextFromFile = useCallback(async (file: File): Promise<string> => {
    const base64 = await fileToBase64(file);

    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

    // Browser-supplied MIME is often empty for .docx and sometimes for .txt
    // copied from cloud sources. Fall back to extension so the edge function
    // can route correctly.
    const ext = file.name.split('.').pop()?.toLowerCase();
    const extMime =
      ext === 'pdf' ? 'application/pdf' :
      ext === 'txt' || ext === 'md' ? 'text/plain' :
      ext === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' :
      ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
      ext === 'png' ? 'image/png' :
      ext === 'webp' ? 'image/webp' :
      ext === 'heic' ? 'image/heic' :
      ext === 'heif' ? 'image/heif' : '';
    const effectiveType =
      file.type && file.type !== 'application/octet-stream' ? file.type : extMime;

    try {
      const { data, error } = await supabase.functions.invoke('extract-text', {
        body: {
          file_data: base64,
          file_type: effectiveType,
          file_name: file.name,
        },
      });

      clearTimeout(timeoutId);

      if (error) {
        // Surface the edge function's specific error message + code.
        const ctx = (error as any).context;
        let serverMessage = error.message;
        try {
          if (ctx && typeof ctx.json === 'function') {
            const body = await ctx.json();
            if (body?.error) serverMessage = body.error;
          }
        } catch { /* ignore */ }
        throw new Error(serverMessage);
      }
      return data?.text || '';
    } catch (err) {
      clearTimeout(timeoutId);

      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('Request timeout — try again');
      }
      throw err;
    }
  }, [fileToBase64, timeoutSeconds]);

  /**
   * Attempt extraction with optional auto-retry
   */
  const attemptExtraction = useCallback(async (fileId: string, isAutoRetry: boolean = false) => {
    let fileItem: UploadedFileItem | undefined;
    
    // Get current file state
    setFiles(prev => {
      fileItem = prev.find(f => f.id === fileId);
      return prev;
    });
    
    // Small delay to ensure state is read
    await new Promise(r => setTimeout(r, 10));
    
    if (!fileItem) {
      activeExtractions.current--;
      return;
    }
    
    const currentRetryCount = fileItem.retryCount;
    
    updateFileStatus(fileId, { 
      status: 'processing', 
      statusMessage: isAutoRetry ? 'Retrying extraction...' : 'Extracting text...',
    });
    
    try {
      const text = await extractTextFromFile(fileItem.file);
      updateFileStatus(fileId, { 
        status: 'ready', 
        extractedText: text,
        statusMessage: 'Ready',
        error: undefined,
        retryCount: 0, // Reset on success
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error('Extraction failed for', fileItem.displayName, err);
      
      // Check if we should auto-retry
      if (currentRetryCount < maxAutoRetries) {
        // Exponential backoff: 2^retryCount seconds (2s, 4s, etc.)
        const backoffMs = Math.pow(2, currentRetryCount + 1) * 1000;
        
        updateFileStatus(fileId, { 
          status: 'uploading', // Back to uploading to trigger queue
          statusMessage: `Retrying in ${backoffMs / 1000}s...`,
          retryCount: currentRetryCount + 1,
        });
        
        // Schedule retry after backoff
        setTimeout(() => {
          activeExtractions.current++;
          attemptExtraction(fileId, true);
        }, backoffMs);
      } else {
        updateFileStatus(fileId, { 
          status: 'failed',
          statusMessage: 'Upload stalled — tap Retry',
          error: errorMessage,
        });
      }
    } finally {
      activeExtractions.current--;
      processExtractionQueue();
    }
  }, [extractTextFromFile, updateFileStatus, maxAutoRetries]);

  /**
   * Process extraction queue with concurrency limiting
   */
  const processExtractionQueue = useCallback(() => {
    while (
      extractionQueue.current.length > 0 && 
      activeExtractions.current < maxConcurrentExtractions
    ) {
      const fileId = extractionQueue.current.shift();
      if (!fileId) continue;
      
      activeExtractions.current++;
      attemptExtraction(fileId, false);
    }
  }, [maxConcurrentExtractions, attemptExtraction]);

  /**
   * Queue file for extraction
   */
  const queueExtraction = useCallback((fileId: string) => {
    extractionQueue.current.push(fileId);
    processExtractionQueue();
  }, [processExtractionQueue]);

  /**
   * Retry extraction for a failed file (user-initiated)
   */
  const retryExtraction = useCallback((fileId: string) => {
    setFiles(prev => {
      const updated = prev.map(f => 
        f.id === fileId 
          ? { 
              ...f, 
              status: 'queued' as FileStatus, 
              statusMessage: 'Queued for retry...',
              error: undefined,
              retryCount: 0, // Reset retry count for manual retry
              lastActivityAt: new Date(),
            } 
          : f
      );
      updateCombinedText(updated);
      return updated;
    });
    
    // Re-process this file
    queueExtraction(fileId);
    toast({ title: 'Retrying extraction...' });
  }, [queueExtraction, updateCombinedText, toast]);

  /**
   * Watchdog: Check for stalled uploads
   */
  useEffect(() => {
    // Clear existing watchdog
    if (watchdogInterval.current) {
      clearInterval(watchdogInterval.current);
      watchdogInterval.current = null;
    }
    
    // Only run watchdog if there are files being processed
    const hasActiveFiles = files.some(f => 
      f.status === 'uploading' || f.status === 'processing'
    );
    
    if (!hasActiveFiles) return;
    
    watchdogInterval.current = window.setInterval(() => {
      const now = new Date();
      
      setFiles(prev => {
        let hasChanges = false;
        const updated = prev.map(f => {
          // Check if file is stalled
          if (
            (f.status === 'uploading' || f.status === 'processing') &&
            (now.getTime() - f.lastActivityAt.getTime()) > (timeoutSeconds * 1000)
          ) {
            hasChanges = true;
            
            // Check if we should auto-retry
            if (f.retryCount < maxAutoRetries) {
              return {
                ...f,
                status: 'queued' as FileStatus,
                statusMessage: 'Stalled — auto-retrying...',
                retryCount: f.retryCount + 1,
                lastActivityAt: now,
              };
            }
            
            return {
              ...f,
              status: 'failed' as FileStatus,
              statusMessage: 'Upload stalled — tap Retry',
              error: 'Timed out',
              lastActivityAt: now,
            };
          }
          return f;
        });
        
        if (hasChanges) {
          updateCombinedText(updated);
          
          // Re-queue any files that were set to 'queued' for retry
          updated.forEach(f => {
            if (f.status === 'queued' && f.statusMessage?.includes('auto-retrying')) {
              setTimeout(() => queueExtraction(f.id), 500);
            }
          });
        }
        
        return hasChanges ? updated : prev;
      });
    }, 5000); // Check every 5 seconds
    
    return () => {
      if (watchdogInterval.current) {
        clearInterval(watchdogInterval.current);
        watchdogInterval.current = null;
      }
    };
  }, [files, timeoutSeconds, maxAutoRetries, updateCombinedText, queueExtraction]);

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
      'text/plain',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    const allowedExts = ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'txt', 'md', 'docx'];

    const newFileItems: UploadedFileItem[] = [];
    const errors: string[] = [];

    for (const selectedFile of Array.from(selectedFiles)) {
      const fileType = (selectedFile.type || '').toLowerCase();
      const ext = selectedFile.name.split('.').pop()?.toLowerCase();
      const okByExt = !!ext && allowedExts.includes(ext);
      const okByMime = allowedMimes.includes(fileType);

      if (!okByExt && !okByMime) {
        errors.push(`Skipped ${selectedFile.name}: Unsupported file type`);
        continue;
      }

      // Check file size (20MB max for large files, warn at 10MB)
      if (selectedFile.size > 20 * 1024 * 1024) {
        errors.push(`Skipped ${selectedFile.name}: File too large (max 20MB)`);
        continue;
      }

      const isHeicOrHeif = 
        fileType === 'image/heic' || 
        fileType === 'image/heif' ||
        ext === 'heic' || 
        ext === 'heif';

      const id = getFileId(selectedFile);
      const displayName = getUniqueDisplayName(selectedFile.name);
      
      // Create initial file item with queued status
      const thumbnailUrl = !isHeicOrHeif ? generateThumbnail(selectedFile) : undefined;
      
      const fileItem: UploadedFileItem = {
        id,
        file: selectedFile,
        originalFile: isHeicOrHeif ? selectedFile : undefined,
        fileName: selectedFile.name,
        displayName,
        mimeType: selectedFile.type,
        size: selectedFile.size,
        status: 'queued',
        statusMessage: 'Queued...',
        thumbnailUrl,
        extractedText: '',
        createdAt: new Date(),
        lastActivityAt: new Date(),
        retryCount: 0,
      };
      
      newFileItems.push(fileItem);
    }

    // Show errors if any
    if (errors.length > 0) {
      toast({
        title: 'Some files were skipped',
        description: errors.slice(0, 3).join('. ') + (errors.length > 3 ? ` (+${errors.length - 3} more)` : ''),
        variant: 'destructive',
      });
    }

    if (newFileItems.length === 0) return;

    // Add files immediately to state (optimistic)
    setFiles(prev => {
      const updated = [...prev, ...newFileItems];
      updateCombinedText(updated);
      return updated;
    });

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
          updateFileStatus(fileItem.id, { 
            status: 'uploading',
            statusMessage: isHeicOrHeif ? 'Converting HEIC...' : 'Preparing...',
          });

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
                statusMessage: 'Uploading...',
              });
            } catch (err) {
              console.error('HEIC conversion failed:', err);
              updateFileStatus(fileItem.id, {
                status: 'failed',
                statusMessage: 'HEIC conversion failed',
                error: 'HEIC conversion failed. Try uploading as JPG/PNG.',
              });
              return;
            }
          } else if (processedFile.type.startsWith('image/') && processedFile.type !== 'application/pdf') {
            // Compress images
            try {
              updateFileStatus(fileItem.id, { statusMessage: 'Compressing...' });
              const compressed = await compressImage(processedFile);
              processedFile = new File([compressed], processedFile.name, { type: 'image/jpeg' });
              updateFileStatus(fileItem.id, {
                file: processedFile,
                size: processedFile.size,
                statusMessage: 'Uploading...',
              });
            } catch (err) {
              console.warn('Image compression failed, using original:', err);
            }
          }

          // Mark as uploading complete, queue for extraction
          updateFileStatus(fileItem.id, { 
            status: 'uploading',
            statusMessage: 'Queued for extraction...',
          });
          
          // Queue for extraction
          queueExtraction(fileItem.id);
          
        } catch (err) {
          console.error('File processing failed:', err);
          updateFileStatus(fileItem.id, {
            status: 'failed',
            statusMessage: 'Processing failed',
            error: err instanceof Error ? err.message : 'Processing failed',
          });
        }
      })();
    }
  }, [
    getFileId,
    getUniqueDisplayName,
    generateThumbnail, 
    convertHeicToJpeg, 
    compressImage,
    updateFileStatus, 
    queueExtraction,
    updateCombinedText,
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
      
      // Remove from extraction queue if present
      extractionQueue.current = extractionQueue.current.filter(id => id !== fileId);
      
      const updated = prev.filter(f => f.id !== fileId);
      updateCombinedText(updated);
      return updated;
    });
  }, [updateCombinedText]);

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
    usedFilenames.current.clear();
  }, []);

  /**
   * Inject pre-extracted files (e.g. sample documents with known text)
   * Bypasses upload/extraction pipeline - files are immediately "ready"
   */
  const injectReadyFiles = useCallback((
    items: Array<{ fileName: string; extractedText: string }>
  ) => {
    const newFileItems: UploadedFileItem[] = items.map(item => {
      const blob = new Blob([item.extractedText], { type: 'text/plain' });
      const file = new File([blob], item.fileName, { type: 'text/plain' });
      const displayName = getUniqueDisplayName(item.fileName);
      
      return {
        id: `sample_${item.fileName}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        file,
        fileName: item.fileName,
        displayName,
        mimeType: 'text/plain',
        size: blob.size,
        status: 'ready' as FileStatus,
        statusMessage: 'Ready',
        extractedText: item.extractedText,
        createdAt: new Date(),
        lastActivityAt: new Date(),
        retryCount: 0,
      };
    });

    setFiles(prev => {
      const updated = [...prev, ...newFileItems];
      updateCombinedText(updated);
      return updated;
    });
  }, [getUniqueDisplayName, updateCombinedText]);

  /**
   * Set combined text manually (for user edits)
   */
  const setCombinedTextManual = useCallback((text: string) => {
    setCombinedText(text);
  }, []);

  // Calculate statistics
  const totalFiles = files.length;
  const completedFiles = files.filter(f => f.status === 'ready').length;
  const failedFiles = files.filter(f => f.status === 'failed').length;
  const isExtracting = files.some(f => 
    f.status === 'queued' || 
    f.status === 'uploading' || 
    f.status === 'processing'
  );
  const hasReadyFiles = files.some(f => f.status === 'ready');
  const progress = totalFiles > 0 ? (completedFiles / totalFiles) * 100 : 0;
  const allFilesReady = totalFiles > 0 && completedFiles === totalFiles;

  // isProcessing alias for convenience (same as isExtracting)
  const isProcessing = isExtracting;

  return {
    files,
    setFiles,
    combinedText,
    setCombinedText: setCombinedTextManual,
    addFiles,
    injectReadyFiles,
    removeFile,
    clearAllFiles,
    retryExtraction,
    // Stats
    totalFiles,
    completedFiles,
    failedFiles,
    isExtracting,
    isProcessing,
    hasReadyFiles,
    allFilesReady,
    progress,
  };
}
