/**
 * Optimistic File Upload Hook
 * 
 * Handles file uploads with:
 * - Immediate display with status chips (Queued, Uploading, Extracting, Ready, Failed)
 * - Client-side thumbnail generation
 * - Image compression/resize before upload
 * - HEIC to JPEG conversion
 * - Background extraction with concurrency limiting (max 2-3 concurrent)
 * - Combined text streaming as files complete
 * - Retry functionality for failed extractions
 */

import { useState, useCallback, useRef } from 'react';
import heic2any from 'heic2any';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export type FileStatus = 'queued' | 'uploading' | 'uploaded' | 'extracting' | 'ready' | 'failed';

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
  createdAt: Date;
}

interface UseFileUploadOptions {
  maxConcurrentExtractions?: number;
  maxDimension?: number;
  jpegQuality?: number;
}

const DEFAULT_OPTIONS: Required<UseFileUploadOptions> = {
  maxConcurrentExtractions: 2,
  maxDimension: 1600,
  jpegQuality: 0.75,
};

export function useFileUpload(options: UseFileUploadOptions = {}) {
  const { maxConcurrentExtractions, maxDimension, jpegQuality } = { ...DEFAULT_OPTIONS, ...options };
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
   * Update combined text from all files
   */
  const updateCombinedText = useCallback((fileList: UploadedFileItem[]) => {
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
    
    setCombinedText(parts.join('\n\n'));
  }, []);

  /**
   * Update file status
   */
  const updateFileStatus = useCallback((
    fileId: string, 
    updates: Partial<UploadedFileItem>
  ) => {
    setFiles(prev => {
      const updated = prev.map(f => 
        f.id === fileId ? { ...f, ...updates } : f
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
      const fileId = extractionQueue.current.shift();
      if (!fileId) continue;
      
      activeExtractions.current++;
      
      // Get file from state
      setFiles(prev => {
        const fileItem = prev.find(f => f.id === fileId);
        if (!fileItem || fileItem.status !== 'uploaded') {
          activeExtractions.current--;
          return prev;
        }
        
        // Start extraction in background
        (async () => {
          updateFileStatus(fileId, { status: 'extracting' });
          
          try {
            const text = await extractTextFromFile(fileItem.file);
            updateFileStatus(fileId, { 
              status: 'ready', 
              extractedText: text,
              error: undefined 
            });
          } catch (err) {
            console.error('Extraction failed for', fileItem.fileName, err);
            updateFileStatus(fileId, { 
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
  const queueExtraction = useCallback((fileId: string) => {
    extractionQueue.current.push(fileId);
    processExtractionQueue();
  }, [processExtractionQueue]);

  /**
   * Retry extraction for a failed file
   */
  const retryExtraction = useCallback((fileId: string) => {
    setFiles(prev => {
      const updated = prev.map(f => 
        f.id === fileId ? { ...f, status: 'uploaded' as FileStatus, error: undefined } : f
      );
      updateCombinedText(updated);
      return updated;
    });
    queueExtraction(fileId);
    toast({ title: 'Retrying extraction...' });
  }, [queueExtraction, updateCombinedText, toast]);

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
  }, []);

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
    f.status === 'uploaded' || 
    f.status === 'extracting'
  );
  const hasReadyFiles = files.some(f => f.status === 'ready');
  const progress = totalFiles > 0 ? (completedFiles / totalFiles) * 100 : 0;

  return {
    files,
    combinedText,
    setCombinedText: setCombinedTextManual,
    addFiles,
    removeFile,
    clearAllFiles,
    retryExtraction,
    // Stats
    totalFiles,
    completedFiles,
    failedFiles,
    isExtracting,
    hasReadyFiles,
    progress,
  };
}
