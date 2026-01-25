/**
 * Student Submissions Hook (v2 - Automatic Grouping)
 * 
 * Manages student work uploads with AUTOMATIC student grouping.
 * No manual "assign pages to students" step required by default.
 * 
 * FIXED: Uses Promise.allSettled() for batch extraction to prevent stuck states.
 * Per-file status tracking ensures one failure doesn't block others.
 * 
 * Auto-grouping rules:
 * 1. Parse assignmentId from filename (first token before _ or -)
 * 2. Detect student name from filename OR extracted text
 * 3. Group by groupKey = assignmentId + "::" + normalizedStudentName
 * 4. Combine multi-page submissions with PAGE BREAK separators
 * 5. Grade each SubmissionGroup independently
 * 
 * Files with no detected student name are marked as "Unknown Student" with needs_review = true
 */

import { useState, useCallback, useRef, useMemo } from 'react';
import heic2any from 'heic2any';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { 
  parseFileInfo, 
  normalizeStudentName, 
  detectMultipleStudentsInText,
  type ParsedFileInfo,
} from '@/lib/student-name-detector';

export type FileStatus = 'queued' | 'uploading' | 'uploaded' | 'extracting' | 'ready' | 'failed';

// Helper to check if a status is "processing"
const isProcessingStatus = (status: FileStatus): boolean => 
  ['queued', 'uploading', 'uploaded', 'extracting'].includes(status);

export interface PageRecord {
  id: string;
  file: File;
  originalFileName: string;
  mimeType: string;
  size: number;
  status: FileStatus;
  extractedText: string;
  uploadedAt: Date;
  error?: string;
  // Parsed info from filename/text
  parsedInfo?: ParsedFileInfo;
  pageNumber?: number; // For ordering
}

export interface SubmissionGroup {
  groupId: string;
  assignmentId: string;
  studentName: string;
  pages: PageRecord[];
  combinedText: string;
  needsReview: boolean; // True if studentName is "Unknown Student"
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

const PAGE_BREAK_SEPARATOR = '\n\n--- PAGE BREAK ---\n\n';

export function useStudentSubmissions(options: UseStudentSubmissionsOptions = {}) {
  const { maxConcurrentExtractions, maxDimension, jpegQuality } = { ...DEFAULT_OPTIONS, ...options };
  const { toast } = useToast();
  
  // Pending pages (extraction in progress, not yet grouped)
  const [pendingPages, setPendingPages] = useState<PageRecord[]>([]);
  
  // Grouped submissions
  const [groups, setGroups] = useState<SubmissionGroup[]>([]);
  
  // Track active extractions for concurrency control
  const activeExtractions = useRef(0);
  const extractionQueue = useRef<string[]>([]);

  /**
   * Generate unique ID
   */
  const generateId = useCallback((): string => {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
   * Update combined text for a group based on its pages
   * Pages are sorted by page number (if available) then upload order
   */
  const updateGroupCombinedText = useCallback((groupId: string) => {
    setGroups(prev => prev.map(group => {
      if (group.groupId !== groupId) return group;
      
      // Sort pages by page number, then by upload time
      const sortedPages = [...group.pages].sort((a, b) => {
        const pageA = a.pageNumber ?? a.parsedInfo?.pageNumber ?? 999;
        const pageB = b.pageNumber ?? b.parsedInfo?.pageNumber ?? 999;
        
        if (pageA !== pageB) return pageA - pageB;
        return a.uploadedAt.getTime() - b.uploadedAt.getTime();
      });
      
      // Combine text with page break separators
      const combinedParts = sortedPages.map(page => {
        if (page.status === 'ready' && page.extractedText) {
          return page.extractedText;
        } else if (page.status === 'extracting') {
          return '[Extracting text...]';
        } else if (page.status === 'failed') {
          return `[Extraction failed${page.error ? `: ${page.error}` : ''}]`;
        }
        return '[Waiting for extraction...]';
      });
      
      return {
        ...group,
        pages: sortedPages,
        combinedText: combinedParts.join(PAGE_BREAK_SEPARATOR),
      };
    }));
  }, []);

  /**
   * Add a page to the appropriate group based on its groupKey
   */
  const addPageToGroup = useCallback((page: PageRecord) => {
    if (!page.parsedInfo) return;
    
    const { groupKey, assignmentId, studentName, needsReview } = page.parsedInfo;
    
    setGroups(prev => {
      const existingGroup = prev.find(g => 
        `${g.assignmentId}::${normalizeStudentName(g.studentName)}` === groupKey
      );
      
      if (existingGroup) {
        // Add to existing group
        return prev.map(g => {
          if (g.groupId !== existingGroup.groupId) return g;
          return {
            ...g,
            pages: [...g.pages, page],
            needsReview: g.needsReview || needsReview,
          };
        });
      } else {
        // Create new group
        const newGroup: SubmissionGroup = {
          groupId: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          assignmentId,
          studentName,
          pages: [page],
          combinedText: '',
          needsReview,
          createdAt: new Date(),
        };
        return [...prev, newGroup];
      }
    });

    // Remove from pending
    setPendingPages(prev => prev.filter(p => p.id !== page.id));

    // Update combined text after state update
    setTimeout(() => {
      setGroups(currentGroups => {
        const group = currentGroups.find(g => 
          `${g.assignmentId}::${normalizeStudentName(g.studentName)}` === groupKey
        );
        if (group) {
          updateGroupCombinedText(group.groupId);
        }
        return currentGroups;
      });
    }, 50);
  }, [updateGroupCombinedText]);

  /**
   * Update pending page status
   */
  const updatePendingPageStatus = useCallback((
    pageId: string, 
    updates: Partial<PageRecord>
  ) => {
    setPendingPages(prev => prev.map(p => 
      p.id === pageId ? { ...p, ...updates } : p
    ));
  }, []);

  /**
   * Update page status within a group
   */
  const updateGroupPageStatus = useCallback((
    groupId: string,
    pageId: string, 
    updates: Partial<PageRecord>
  ) => {
    setGroups(prev => prev.map(group => {
      if (group.groupId !== groupId) return group;
      return {
        ...group,
        pages: group.pages.map(p => 
          p.id === pageId ? { ...p, ...updates } : p
        )
      };
    }));
    updateGroupCombinedText(groupId);
  }, [updateGroupCombinedText]);

  /**
   * Process a single extraction (used by queue processor)
   * Returns a promise that resolves when extraction completes (success or fail)
   */
  const processExtraction = useCallback(async (pageId: string): Promise<void> => {
    // Get current page data
    let pageToProcess: PageRecord | undefined;
    
    setPendingPages(prev => {
      pageToProcess = prev.find(p => p.id === pageId);
      return prev;
    });
    
    if (!pageToProcess || pageToProcess.status !== 'uploaded') {
      return;
    }
    
    // Update to extracting
    setPendingPages(prev => prev.map(p => 
      p.id === pageId ? { ...p, status: 'extracting' as FileStatus } : p
    ));
    
    try {
      const text = await extractTextFromFile(pageToProcess.file);
      const parsedInfo = parseFileInfo(pageToProcess.originalFileName, text);
      
      // Get fresh page data and update to ready
      setPendingPages(prev => {
        const freshPage = prev.find(p => p.id === pageId);
        if (!freshPage) return prev;
        
        const updatedPage: PageRecord = {
          ...freshPage,
          status: 'ready',
          extractedText: text,
          parsedInfo,
          pageNumber: parsedInfo.pageNumber ?? undefined,
          error: undefined,
        };
        
        // Schedule move to group (do it after state update)
        setTimeout(() => addPageToGroup(updatedPage), 0);
        
        // Remove from pending since it's moving to a group
        return prev.filter(p => p.id !== pageId);
      });
      
    } catch (err) {
      console.error('Extraction failed for', pageToProcess.originalFileName, err);
      setPendingPages(prev => prev.map(p => 
        p.id === pageId ? { 
          ...p, 
          status: 'failed' as FileStatus,
          error: err instanceof Error ? err.message : 'Unknown error'
        } : p
      ));
    }
  }, [extractTextFromFile, addPageToGroup]);

  /**
   * Process extraction queue with concurrency limiting
   * Uses Promise.allSettled to ensure one failure doesn't block others
   */
  const processExtractionQueue = useCallback(async () => {
    // Get pages ready for extraction
    const pagesToExtract: string[] = [];
    
    while (
      extractionQueue.current.length > 0 && 
      activeExtractions.current + pagesToExtract.length < maxConcurrentExtractions
    ) {
      const pageId = extractionQueue.current.shift();
      if (pageId) {
        pagesToExtract.push(pageId);
        activeExtractions.current++;
      }
    }
    
    if (pagesToExtract.length === 0) return;
    
    // Process all concurrently with Promise.allSettled
    const results = await Promise.allSettled(
      pagesToExtract.map(pageId => processExtraction(pageId))
    );
    
    // Decrease active count for each completed extraction
    results.forEach(() => {
      activeExtractions.current--;
    });
    
    // Continue processing queue if there are more items
    if (extractionQueue.current.length > 0) {
      processExtractionQueue();
    }
  }, [maxConcurrentExtractions, processExtraction]);

  /**
   * Queue page for extraction
   */
  const queueExtraction = useCallback((pageId: string) => {
    extractionQueue.current.push(pageId);
    processExtractionQueue();
  }, [processExtractionQueue]);

  /**
   * Retry extraction for a failed page
   */
  const retryExtraction = useCallback((groupId: string, pageId: string) => {
    setGroups(prev => {
      const group = prev.find(g => g.groupId === groupId);
      const page = group?.pages.find(p => p.id === pageId);
      
      if (page) {
        // Move page back to pending for re-extraction
        setPendingPages(pending => [...pending, { ...page, status: 'uploaded', error: undefined }]);
        queueExtraction(pageId);
      }
      
      return prev.map(g => {
        if (g.groupId !== groupId) return g;
        return { ...g, pages: g.pages.filter(p => p.id !== pageId) };
      });
    });
    
    toast({ title: 'Retrying extraction...' });
  }, [queueExtraction, toast]);

  /**
   * Retry extraction for a pending page
   */
  const retryPendingExtraction = useCallback((pageId: string) => {
    updatePendingPageStatus(pageId, { status: 'uploaded', error: undefined });
    queueExtraction(pageId);
    toast({ title: 'Retrying extraction...' });
  }, [updatePendingPageStatus, queueExtraction, toast]);

  /**
   * Process a single file (conversion, compression, queue for extraction)
   */
  const processFile = useCallback(async (page: PageRecord) => {
    try {
      let processedFile = page.file;
      const ext = page.originalFileName.split('.').pop()?.toLowerCase();
      const isHeicOrHeif = 
        page.mimeType === 'image/heic' || 
        page.mimeType === 'image/heif' ||
        ext === 'heic' || 
        ext === 'heif';

      updatePendingPageStatus(page.id, { status: 'uploading' });

      if (isHeicOrHeif) {
        try {
          processedFile = await convertHeicToJpeg(page.file);
          updatePendingPageStatus(page.id, {
            file: processedFile,
            mimeType: processedFile.type,
            size: processedFile.size,
          });
        } catch (err) {
          console.error('HEIC conversion failed:', err);
          updatePendingPageStatus(page.id, {
            status: 'failed',
            error: 'HEIC conversion failed. Try uploading as JPG/PNG.',
          });
          return;
        }
      } else if (processedFile.type.startsWith('image/') && processedFile.type !== 'application/pdf') {
        try {
          const compressed = await compressImage(processedFile);
          processedFile = new File([compressed], processedFile.name, { type: 'image/jpeg' });
          updatePendingPageStatus(page.id, {
            file: processedFile,
            size: processedFile.size,
          });
        } catch (err) {
          console.warn('Image compression failed, using original:', err);
        }
      }

      updatePendingPageStatus(page.id, { status: 'uploaded' });
      queueExtraction(page.id);
      
    } catch (err) {
      console.error('File processing failed:', err);
      updatePendingPageStatus(page.id, {
        status: 'failed',
        error: err instanceof Error ? err.message : 'Processing failed',
      });
    }
  }, [convertHeicToJpeg, compressImage, updatePendingPageStatus, queueExtraction]);

  /**
   * Add files - creates page records and starts processing
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

    const newPages: PageRecord[] = [];
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

      const pageId = generateId();
      
      const page: PageRecord = {
        id: pageId,
        file: selectedFile,
        originalFileName: selectedFile.name,
        mimeType: selectedFile.type,
        size: selectedFile.size,
        status: 'queued',
        extractedText: '',
        uploadedAt: new Date(),
      };
      
      newPages.push(page);
    }

    if (errors.length > 0) {
      toast({
        title: 'Some files were skipped',
        description: errors.join('. '),
        variant: 'destructive',
      });
    }

    if (newPages.length === 0) return;

    // Add all pages to pending
    setPendingPages(prev => [...prev, ...newPages]);
    
    toast({ 
      title: `${newPages.length} file(s) added`,
      description: 'Processing and detecting student names...',
      duration: 3000,
    });

    // Process each file
    for (const page of newPages) {
      processFile(page);
    }
  }, [generateId, toast, processFile]);

  /**
   * Rename a student in a group
   */
  const renameStudent = useCallback((groupId: string, newName: string) => {
    setGroups(prev => prev.map(group => 
      group.groupId === groupId 
        ? { ...group, studentName: newName.trim(), needsReview: false } 
        : group
    ));
    toast({ title: 'Student name updated' });
  }, [toast]);

  /**
   * Remove a page from a group
   */
  const removePage = useCallback((groupId: string, pageId: string) => {
    setGroups(prev => {
      const updatedGroups = prev.map(group => {
        if (group.groupId !== groupId) return group;
        return { ...group, pages: group.pages.filter(p => p.id !== pageId) };
      });
      // Remove empty groups
      return updatedGroups.filter(g => g.pages.length > 0);
    });
  }, []);

  /**
   * Remove a pending page
   */
  const removePendingPage = useCallback((pageId: string) => {
    setPendingPages(prev => prev.filter(p => p.id !== pageId));
  }, []);

  /**
   * Delete an entire group
   */
  const deleteGroup = useCallback((groupId: string) => {
    setGroups(prev => prev.filter(g => g.groupId !== groupId));
    toast({ title: 'Student submission removed' });
  }, [toast]);

  /**
   * Clear all submissions and pending pages
   */
  const clearAll = useCallback(() => {
    setPendingPages([]);
    setGroups([]);
    extractionQueue.current = [];
  }, []);

  /**
   * Check for multiple students detected in a single group's combined text
   * This is a safety check
   */
  const getMultipleStudentsWarning = useCallback((): string | null => {
    for (const group of groups) {
      if (group.pages.length > 1) {
        const detectedNames = detectMultipleStudentsInText(group.combinedText);
        if (detectedNames.length > 1) {
          return `Multiple students detected in "${group.studentName}" group — please verify or split.`;
        }
      }
    }
    return null;
  }, [groups]);

  // Calculate statistics using useMemo for performance and proper derivation
  const stats = useMemo(() => {
    const totalPendingPages = pendingPages.length;
    const totalGroups = groups.length;
    const totalGroupedPages = groups.reduce((acc, g) => acc + g.pages.length, 0);
    const totalPages = totalPendingPages + totalGroupedPages;
    
    const readyPages = groups.reduce((acc, g) => 
      acc + g.pages.filter(p => p.status === 'ready').length, 0
    );
    
    const failedPendingPages = pendingPages.filter(p => p.status === 'failed').length;
    const failedGroupPages = groups.reduce((acc, g) => 
      acc + g.pages.filter(p => p.status === 'failed').length, 0
    );
    const failedPages = failedPendingPages + failedGroupPages;
    
    // DERIVED isExtracting: true if ANY file is in a processing state
    const isExtracting = pendingPages.some(p => isProcessingStatus(p.status)) ||
      groups.some(g => g.pages.some(p => isProcessingStatus(p.status)));
    
    const needsReviewCount = groups.filter(g => g.needsReview).length;
    
    // Can grade if: no pending pages in processing state, at least one group with ready pages
    const hasReadyGroups = groups.some(g => g.pages.some(p => p.status === 'ready'));
    
    // Processing pending pages are those not yet failed or ready
    const processingPendingCount = pendingPages.filter(p => isProcessingStatus(p.status)).length;
    const canGrade = processingPendingCount === 0 && hasReadyGroups && !isExtracting;
    
    const progress = totalPages > 0 ? ((readyPages + failedPages) / totalPages) * 100 : 0;
    
    return {
      totalPendingPages,
      totalGroups,
      totalGroupedPages,
      totalPages,
      readyPages,
      failedPages,
      isExtracting,
      needsReviewCount,
      hasReadyGroups,
      canGrade,
      progress,
    };
  }, [pendingPages, groups]);

  // Multiple students warning
  const multipleStudentsWarning = getMultipleStudentsWarning();

  return {
    // Pending pages (still being processed)
    pendingPages,
    removePendingPage,
    retryPendingExtraction,
    
    // Grouped submissions
    groups,
    renameStudent,
    removePage,
    deleteGroup,
    retryExtraction,
    
    // Actions
    addFiles,
    clearAll,
    
    // Statistics (derived from useMemo)
    totalPages: stats.totalPages,
    totalPendingPages: stats.totalPendingPages,
    totalGroups: stats.totalGroups,
    totalGroupedPages: stats.totalGroupedPages,
    readyPages: stats.readyPages,
    failedPages: stats.failedPages,
    isExtracting: stats.isExtracting,
    needsReviewCount: stats.needsReviewCount,
    hasReadyGroups: stats.hasReadyGroups,
    canGrade: stats.canGrade,
    progress: stats.progress,
    
    // Warnings
    multipleStudentsWarning,
    
    // Legacy compatibility aliases
    submissions: groups.map(g => ({
      id: g.groupId,
      studentName: g.studentName,
      assignmentName: g.assignmentId !== 'default' ? g.assignmentId : undefined,
      files: g.pages.map(p => ({
        id: p.id,
        file: p.file,
        fileName: p.originalFileName,
        mimeType: p.mimeType,
        size: p.size,
        status: p.status,
        extractedText: p.extractedText,
        createdAt: p.uploadedAt,
        error: p.error,
      })),
      combinedText: g.combinedText,
      createdAt: g.createdAt,
      autoDetected: true,
    })),
    ungroupedFiles: pendingPages.map(p => ({
      id: p.id,
      file: p.file,
      fileName: p.originalFileName,
      mimeType: p.mimeType,
      size: p.size,
      status: p.status,
      extractedText: p.extractedText,
      createdAt: p.uploadedAt,
      error: p.error,
    })),
    totalUngroupedFiles: stats.totalPendingPages,
    allFilesAssigned: stats.totalPendingPages === 0,
    hasReadySubmissions: stats.hasReadyGroups,
    totalFiles: stats.totalPages,
    completedFiles: stats.readyPages,
  };
}
