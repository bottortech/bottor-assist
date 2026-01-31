/**
 * Grouping Review Modal
 * 
 * Lightweight confirmation screen for multi-page uploads when
 * grouping confidence is low (possible interleaving detected).
 * 
 * Features:
 * - Shows student groups with page thumbnails
 * - Drag-and-drop page reassignment
 * - Quick confirm/edit interface
 */

import { useState, useCallback, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AlertTriangle,
  FileText,
  GripVertical,
  User,
  Check,
  ChevronDown,
  ChevronUp,
  Edit2,
} from 'lucide-react';
import { UploadedFileItem } from '@/hooks/useFileUpload';

interface PageItem {
  fileId: string;
  fileName: string;
  displayName: string;
  thumbnailUrl?: string;
  hasDetectedName: boolean;
  detectedName?: string;
  pageIndex: number; // Original upload order
}

export interface StudentGroupPreview {
  studentName: string;
  isEditing: boolean;
  pages: PageItem[];
  nameSource: 'document' | 'filename' | 'unknown';
  nameConfidence: 'high' | 'low';
}

interface GroupingReviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: StudentGroupPreview[];
  onConfirm: (confirmedGroups: StudentGroupPreview[]) => void;
  onCancel: () => void;
}

export interface GroupingResult {
  groups: StudentGroupPreview[];
  confidence: 'high' | 'low';
  hasInterleaving: boolean;
  unnamedPageCount: number;
  totalPageCount: number;
}

/**
 * SEQUENTIAL GROUPING LOGIC
 * 
 * Simple rules:
 * 1. Scan first image for a student name → Start Group 1
 * 2. Keep assigning subsequent pages to Group 1 UNTIL a NEW name is found
 * 3. When NEW name found → Start Group 2
 * 4. Repeat pattern
 * 
 * CRITICAL:
 * - Only look for names to START new groups
 * - Pages following a named page automatically belong to that student
 * - Don't scan every page for names (that causes false detections)
 */
export function analyzeAndGroupFiles(
  files: UploadedFileItem[],
  detectName: (text: string) => { name: string; source: 'document' | 'unknown'; confidence: 'high' | 'low' }
): GroupingResult {
  if (files.length === 0) {
    return {
      groups: [],
      confidence: 'high',
      hasInterleaving: false,
      unnamedPageCount: 0,
      totalPageCount: 0,
    };
  }

  // Build page items (without detection yet - we'll do sequential detection)
  const pages: PageItem[] = files.map((file, idx) => ({
    fileId: file.id,
    fileName: file.fileName,
    displayName: file.displayName,
    thumbnailUrl: file.thumbnailUrl,
    hasDetectedName: false, // Will be set during sequential processing
    detectedName: undefined,
    pageIndex: idx,
  }));

  const groups: StudentGroupPreview[] = [];
  let currentGroup: StudentGroupPreview | null = null;
  let knownStudentNames = new Set<string>();
  
  // Process pages SEQUENTIALLY
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const file = files[i];
    
    // Determine if we should look for a name on this page
    // Rule: Only look for names if:
    //   1. It's the first page (i === 0), OR
    //   2. We're starting a potential new student's work
    //      (but be conservative - only start new group if we see a CLEAR name)
    
    const shouldDetectName = 
      i === 0 || // Always check first page
      !currentGroup || // No current group yet
      currentGroup.nameSource === 'unknown'; // Current group has no confirmed name
    
    let detection: { name: string; source: 'document' | 'unknown'; confidence: 'high' | 'low' } = { 
      name: '', 
      source: 'unknown', 
      confidence: 'low' 
    };
    
    if (shouldDetectName) {
      detection = detectName(file.extractedText);
    } else {
      // For subsequent pages, ONLY detect if there's a very clear name indicator
      // (explicit "Name:" label in header area)
      const hasExplicitNameLabel = /^(name|student\s*name)\s*[:=]/im.test(
        file.extractedText.split('\n').slice(0, 3).join('\n')
      );
      
      if (hasExplicitNameLabel) {
        detection = detectName(file.extractedText);
      }
    }
    
    const foundNewName = detection.name.length > 0 && 
                          detection.source === 'document' &&
                          !knownStudentNames.has(detection.name.toLowerCase());
    
    if (foundNewName) {
      // NEW STUDENT DETECTED - Start a new group
      page.hasDetectedName = true;
      page.detectedName = detection.name;
      knownStudentNames.add(detection.name.toLowerCase());
      
      currentGroup = {
        studentName: detection.name,
        isEditing: false,
        pages: [page],
        nameSource: detection.source,
        nameConfidence: detection.confidence,
      };
      groups.push(currentGroup);
      
    } else if (currentGroup) {
      // NO NEW NAME - Add to current student's group (sequential assumption)
      page.hasDetectedName = false;
      currentGroup.pages.push(page);
      
    } else {
      // First page has no name - create "Unknown Student" group
      page.hasDetectedName = false;
      currentGroup = {
        studentName: 'Unknown Student',
        isEditing: false,
        pages: [page],
        nameSource: 'unknown',
        nameConfidence: 'low',
      };
      groups.push(currentGroup);
    }
  }

  // Calculate confidence
  const unnamedPageCount = pages.filter(p => !p.hasDetectedName).length;
  const hasUnknownStudent = groups.some(g => g.studentName === 'Unknown Student');
  
  // Low confidence if: first page has no name (Unknown Student group exists)
  // High confidence if: at least one clear name detected on first page of each group
  const confidence: 'high' | 'low' = hasUnknownStudent ? 'low' : 'high';

  return {
    groups,
    confidence,
    hasInterleaving: false, // Sequential logic doesn't produce interleaving
    unnamedPageCount,
    totalPageCount: pages.length,
  };
}

export function GroupingReviewModal({
  open,
  onOpenChange,
  groups: initialGroups,
  onConfirm,
  onCancel,
}: GroupingReviewModalProps) {
  const [groups, setGroups] = useState<StudentGroupPreview[]>(initialGroups);
  const [draggedPage, setDraggedPage] = useState<{ groupIndex: number; pageIndex: number } | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set(initialGroups.map((_, i) => i)));

  // Update groups when modal opens with new data
  useEffect(() => {
    if (open) {
      setGroups(initialGroups);
      setExpandedGroups(new Set(initialGroups.map((_, i) => i)));
    }
  }, [open, initialGroups]);

  const handleDragStart = useCallback((groupIndex: number, pageIndex: number) => {
    setDraggedPage({ groupIndex, pageIndex });
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback((targetGroupIndex: number, targetPageIndex?: number) => {
    if (!draggedPage) return;
    
    const { groupIndex: sourceGroupIndex, pageIndex: sourcePageIndex } = draggedPage;
    
    if (sourceGroupIndex === targetGroupIndex) {
      // Reordering within same group
      setGroups(prev => {
        const updated = [...prev];
        const group = { ...updated[sourceGroupIndex] };
        const pages = [...group.pages];
        const [movedPage] = pages.splice(sourcePageIndex, 1);
        const insertIndex = targetPageIndex !== undefined ? targetPageIndex : pages.length;
        pages.splice(insertIndex, 0, movedPage);
        group.pages = pages;
        updated[sourceGroupIndex] = group;
        return updated;
      });
    } else {
      // Moving to different group
      setGroups(prev => {
        const updated = [...prev];
        
        // Remove from source
        const sourceGroup = { ...updated[sourceGroupIndex] };
        const sourcePages = [...sourceGroup.pages];
        const [movedPage] = sourcePages.splice(sourcePageIndex, 1);
        sourceGroup.pages = sourcePages;
        updated[sourceGroupIndex] = sourceGroup;
        
        // Add to target
        const targetGroup = { ...updated[targetGroupIndex] };
        const targetPages = [...targetGroup.pages];
        const insertIndex = targetPageIndex !== undefined ? targetPageIndex : targetPages.length;
        targetPages.splice(insertIndex, 0, movedPage);
        targetGroup.pages = targetPages;
        updated[targetGroupIndex] = targetGroup;
        
        // Remove empty groups
        return updated.filter(g => g.pages.length > 0);
      });
    }
    
    setDraggedPage(null);
  }, [draggedPage]);

  const handleDragEnd = useCallback(() => {
    setDraggedPage(null);
  }, []);

  const toggleGroupExpanded = useCallback((index: number) => {
    setExpandedGroups(prev => {
      const updated = new Set(prev);
      if (updated.has(index)) {
        updated.delete(index);
      } else {
        updated.add(index);
      }
      return updated;
    });
  }, []);

  const startEditingName = useCallback((groupIndex: number) => {
    setGroups(prev => {
      const updated = [...prev];
      updated[groupIndex] = { ...updated[groupIndex], isEditing: true };
      return updated;
    });
  }, []);

  const updateStudentName = useCallback((groupIndex: number, newName: string) => {
    setGroups(prev => {
      const updated = [...prev];
      updated[groupIndex] = { 
        ...updated[groupIndex], 
        studentName: newName,
        isEditing: false,
        nameConfidence: 'high', // User confirmed
      };
      return updated;
    });
  }, []);

  const handleConfirm = useCallback(() => {
    onConfirm(groups);
    onOpenChange(false);
  }, [groups, onConfirm, onOpenChange]);

  const handleCancel = useCallback(() => {
    onCancel();
    onOpenChange(false);
  }, [onCancel, onOpenChange]);

  const totalPages = groups.reduce((sum, g) => sum + g.pages.length, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            Confirm Page Grouping
          </DialogTitle>
          <DialogDescription>
            We detected {groups.length} student{groups.length !== 1 ? 's' : ''} across {totalPages} page{totalPages !== 1 ? 's' : ''}.
            Please verify the grouping is correct before grading.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 px-1 py-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg text-sm text-amber-700 dark:text-amber-300">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>Drag pages between students to reassign them.</span>
        </div>

        <ScrollArea className="flex-1 pr-4 -mr-4">
          <div className="space-y-3 py-2">
            {groups.map((group, groupIndex) => (
              <Card 
                key={groupIndex} 
                className={`transition-colors ${draggedPage && draggedPage.groupIndex !== groupIndex ? 'ring-2 ring-primary/30 ring-dashed' : ''}`}
                onDragOver={handleDragOver}
                onDrop={() => handleDrop(groupIndex)}
              >
                <div 
                  className="flex items-center gap-2 p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => toggleGroupExpanded(groupIndex)}
                >
                  <User className="w-4 h-4 text-muted-foreground" />
                  
                  {group.isEditing ? (
                    <Input
                      autoFocus
                      defaultValue={group.studentName}
                      className="h-7 text-sm font-medium"
                      onClick={e => e.stopPropagation()}
                      onBlur={e => updateStudentName(groupIndex, e.target.value || 'Unknown Student')}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          updateStudentName(groupIndex, e.currentTarget.value || 'Unknown Student');
                        }
                      }}
                    />
                  ) : (
                    <span className="font-medium text-sm flex-1">{group.studentName}</span>
                  )}
                  
                  {!group.isEditing && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={e => {
                        e.stopPropagation();
                        startEditingName(groupIndex);
                      }}
                    >
                      <Edit2 className="w-3 h-3" />
                    </Button>
                  )}
                  
                  <Badge variant="secondary" className="text-xs">
                    {group.pages.length} page{group.pages.length !== 1 ? 's' : ''}
                  </Badge>
                  
                  {group.nameConfidence === 'low' && (
                    <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                      Verify
                    </Badge>
                  )}
                  
                  {expandedGroups.has(groupIndex) ? (
                    <ChevronUp className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
                
                {expandedGroups.has(groupIndex) && (
                  <CardContent className="pt-0 pb-3">
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {group.pages.map((page, pageIndex) => (
                        <div
                          key={page.fileId}
                          draggable
                          onDragStart={() => handleDragStart(groupIndex, pageIndex)}
                          onDragEnd={handleDragEnd}
                          onDragOver={handleDragOver}
                          onDrop={(e) => {
                            e.stopPropagation();
                            handleDrop(groupIndex, pageIndex);
                          }}
                          className={`
                            group relative rounded-lg border bg-muted/30 p-2 cursor-grab active:cursor-grabbing
                            hover:ring-2 hover:ring-primary/50 transition-all
                            ${draggedPage?.groupIndex === groupIndex && draggedPage?.pageIndex === pageIndex 
                              ? 'opacity-50 ring-2 ring-primary' 
                              : ''}
                          `}
                        >
                          <div className="absolute top-1 left-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <GripVertical className="w-3 h-3 text-muted-foreground" />
                          </div>
                          
                          {page.thumbnailUrl ? (
                            <img 
                              src={page.thumbnailUrl} 
                              alt={page.displayName}
                              className="w-full aspect-[3/4] object-cover rounded"
                            />
                          ) : (
                            <div className="w-full aspect-[3/4] bg-muted rounded flex items-center justify-center">
                              <FileText className="w-6 h-6 text-muted-foreground" />
                            </div>
                          )}
                          
                          <p className="text-xs text-muted-foreground mt-1 truncate text-center">
                            {page.displayName}
                          </p>
                          
                          {page.hasDetectedName && (
                            <Badge 
                              variant="outline" 
                              className="absolute top-1 right-1 text-[10px] px-1 py-0 bg-emerald-50 border-emerald-300 text-emerald-700"
                            >
                              ✓
                            </Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                )}
              </Card>
            ))}
          </div>
        </ScrollArea>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleConfirm}>
            <Check className="w-4 h-4 mr-2" />
            Confirm & Grade
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
