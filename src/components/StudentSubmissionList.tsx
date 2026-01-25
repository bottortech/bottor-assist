/**
 * StudentSubmissionList Component (v2 - No Manual Assignment Required)
 * 
 * Displays auto-grouped student submissions with:
 * - Summary banner showing detected student count
 * - Each group as a card with student name, page count, status
 * - "Edit name" for overriding auto-detected names
 * - "View extracted text" drawer (no PDF preview)
 * - No manual "assign pages to students" requirement
 */

import { useState } from 'react';
import { 
  FileText, 
  Loader2, 
  X, 
  RefreshCw, 
  Check, 
  AlertCircle, 
  Clock, 
  Upload, 
  User,
  ChevronDown,
  ChevronRight,
  Edit2,
  Trash2,
  Sparkles,
  AlertTriangle,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { SubmissionGroup, PageRecord, FileStatus } from '@/hooks/useStudentSubmissions';

interface StudentSubmissionListProps {
  pendingPages: PageRecord[];
  groups: SubmissionGroup[];
  onRemovePendingPage: (pageId: string) => void;
  onRetryPendingExtraction: (pageId: string) => void;
  onRenameStudent: (groupId: string, newName: string) => void;
  onRemovePage: (groupId: string, pageId: string) => void;
  onDeleteGroup: (groupId: string) => void;
  onRetryExtraction: (groupId: string, pageId: string) => void;
  isExtracting: boolean;
  progress: number;
  needsReviewCount: number;
  multipleStudentsWarning: string | null;
}

const statusConfig: Record<FileStatus, { 
  label: string; 
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
  icon: React.ComponentType<{ className?: string }>;
  className?: string;
}> = {
  queued: { 
    label: 'Queued', 
    variant: 'outline', 
    icon: Clock,
    className: 'text-muted-foreground border-muted-foreground/30'
  },
  uploading: { 
    label: 'Uploading', 
    variant: 'secondary', 
    icon: Upload,
    className: 'bg-secondary text-secondary-foreground'
  },
  uploaded: { 
    label: 'Uploaded', 
    variant: 'secondary', 
    icon: Check,
    className: 'bg-muted text-muted-foreground'
  },
  extracting: { 
    label: 'Extracting', 
    variant: 'default', 
    icon: Loader2,
    className: 'bg-primary/90 text-primary-foreground animate-pulse'
  },
  ready: { 
    label: 'Ready', 
    variant: 'default', 
    icon: Check,
    className: 'bg-primary/20 text-primary'
  },
  failed: { 
    label: 'Failed', 
    variant: 'destructive', 
    icon: AlertCircle,
    className: 'bg-destructive/10 text-destructive'
  },
};

function StatusBadge({ status }: { status: FileStatus }) {
  const config = statusConfig[status];
  const Icon = config.icon;
  const isAnimated = status === 'extracting' || status === 'uploading';
  
  return (
    <Badge 
      variant={config.variant}
      className={cn('text-xs px-2 py-0.5 gap-1', config.className)}
    >
      <Icon className={cn('w-3 h-3', isAnimated && 'animate-spin')} />
      {config.label}
    </Badge>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Extracted Text Viewer (Sheet/Drawer)
function ExtractedTextSheet({ 
  page, 
  studentName,
  onClose 
}: { 
  page: PageRecord | null;
  studentName?: string;
  onClose: () => void;
}) {
  if (!page) return null;
  
  return (
    <Sheet open={!!page} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-[500px] sm:max-w-[500px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-base">
            <FileText className="w-4 h-4" />
            {page.originalFileName}
          </SheetTitle>
          {studentName && (
            <Badge className="w-fit bg-primary/20 text-primary text-xs">
              <User className="w-3 h-3 mr-1" />
              {studentName}
            </Badge>
          )}
        </SheetHeader>
        <div className="mt-4 flex-1 overflow-auto">
          {page.extractedText ? (
            <div className="p-4 bg-muted/20 rounded-lg">
              <p className="text-sm whitespace-pre-wrap leading-relaxed font-mono">
                {page.extractedText}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic p-4">
              No text extracted yet
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// Group Card Component
interface GroupCardProps {
  group: SubmissionGroup;
  onRename: (newName: string) => void;
  onRemovePage: (pageId: string) => void;
  onDelete: () => void;
  onRetryPage: (pageId: string) => void;
  onShowExtractedText: (page: PageRecord) => void;
}

function GroupCard({
  group,
  onRename,
  onRemovePage,
  onDelete,
  onRetryPage,
  onShowExtractedText,
}: GroupCardProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(group.studentName);

  const readyCount = group.pages.filter(p => p.status === 'ready').length;
  const failedCount = group.pages.filter(p => p.status === 'failed').length;
  const isExtracting = group.pages.some(p => 
    p.status === 'queued' || p.status === 'uploading' || p.status === 'uploaded' || p.status === 'extracting'
  );

  const handleSaveName = () => {
    if (editName.trim()) {
      onRename(editName.trim());
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSaveName();
    if (e.key === 'Escape') {
      setEditName(group.studentName);
      setIsEditing(false);
    }
  };

  return (
    <div className={cn(
      "border rounded-lg overflow-hidden transition-colors",
      group.needsReview 
        ? "border-orange-500/30 bg-orange-500/5" 
        : failedCount > 0 
          ? "border-destructive/30" 
          : "border-primary/30 bg-primary/5"
    )}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        {/* Header */}
        <div className={cn(
          "flex items-center gap-2 p-3",
          group.needsReview ? "bg-orange-500/10" : "bg-primary/10"
        )}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
              {isOpen ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </Button>
          </CollapsibleTrigger>

          <User className={cn(
            "w-4 h-4",
            group.needsReview ? "text-orange-500" : "text-primary"
          )} />

          {isEditing ? (
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleSaveName}
              onKeyDown={handleKeyDown}
              className="h-7 w-40 text-sm"
              autoFocus
            />
          ) : (
            <span 
              className={cn(
                "font-medium text-sm cursor-pointer hover:text-primary",
                group.needsReview && "text-orange-600"
              )}
              onClick={() => setIsEditing(true)}
            >
              {group.studentName}
            </span>
          )}

          {group.needsReview && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <Badge className="bg-orange-500/20 text-orange-600 text-[10px] px-1.5 gap-0.5">
                    <AlertTriangle className="w-2.5 h-2.5" />
                    Review
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">Student name not detected — please verify or edit</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {!group.needsReview && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <Badge className="bg-primary/20 text-primary text-[10px] px-1.5 gap-0.5">
                    <Sparkles className="w-2.5 h-2.5" />
                    Auto
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">Student name auto-detected</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 ml-1"
            onClick={() => setIsEditing(true)}
            title="Edit name"
          >
            <Edit2 className="w-3 h-3 text-muted-foreground" />
          </Button>

          <div className="flex-1" />

          {group.assignmentId !== 'default' && (
            <Badge variant="outline" className="text-xs">
              {group.assignmentId}
            </Badge>
          )}

          <Badge variant="outline" className="text-xs">
            {group.pages.length} page{group.pages.length !== 1 ? 's' : ''}
          </Badge>

          <span className="text-xs text-muted-foreground">
            {readyCount}/{group.pages.length} ready
            {failedCount > 0 && (
              <span className="text-destructive ml-1">• {failedCount} failed</span>
            )}
          </span>

          {isExtracting && (
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
          )}

          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            title="Remove student"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>

        <CollapsibleContent>
          {/* Page List */}
          <div className="p-2 space-y-1">
            {group.pages.map((page, idx) => (
              <div
                key={page.id}
                className={cn(
                  "flex items-center gap-2 p-2 rounded transition-colors",
                  page.status === 'failed' 
                    ? "bg-destructive/5"
                    : page.status === 'ready'
                    ? "bg-background hover:bg-muted/30"
                    : "bg-muted/10"
                )}
              >
                {/* Page number badge */}
                <Badge variant="secondary" className="text-xs px-1.5 py-0 h-5 bg-primary/10 text-primary">
                  Page {page.pageNumber ?? idx + 1}
                </Badge>
                
                <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{page.originalFileName}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatFileSize(page.size)}
                  </p>
                </div>
                
                <StatusBadge status={page.status} />
                
                {/* Show Extracted Text button */}
                {page.status === 'ready' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onShowExtractedText(page)}
                    className="h-7 text-xs text-muted-foreground hover:text-primary"
                    title="View extracted text"
                  >
                    <FileText className="w-3 h-3 mr-1" />
                    Text
                  </Button>
                )}
              
                <div className="flex items-center gap-1">
                  {page.status === 'failed' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onRetryPage(page.id)}
                      className="h-7 w-7 p-0 text-primary"
                      title="Retry"
                    >
                      <RefreshCw className="w-3 h-3" />
                    </Button>
                  )}
                  
                  {page.status !== 'extracting' && page.status !== 'uploading' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onRemovePage(page.id)}
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      title="Remove page"
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              </div>
            ))}

            {group.pages.length === 0 && (
              <div className="text-center py-4 text-sm text-muted-foreground">
                No pages in this submission.
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

export function StudentSubmissionList({
  pendingPages,
  groups,
  onRemovePendingPage,
  onRetryPendingExtraction,
  onRenameStudent,
  onRemovePage,
  onDeleteGroup,
  onRetryExtraction,
  isExtracting,
  progress,
  needsReviewCount,
  multipleStudentsWarning,
}: StudentSubmissionListProps) {
  const [textViewPage, setTextViewPage] = useState<PageRecord | null>(null);
  const [textViewStudentName, setTextViewStudentName] = useState<string>('');

  const hasPending = pendingPages.length > 0;
  const hasGroups = groups.length > 0;

  if (!hasPending && !hasGroups) return null;

  const handleShowExtractedText = (page: PageRecord, studentName?: string) => {
    setTextViewPage(page);
    setTextViewStudentName(studentName || '');
  };
  
  return (
    <div className="space-y-4">
      {/* Summary Banner */}
      {hasGroups && (
        <Alert className="border-primary/30 bg-primary/5">
          <Users className="h-4 w-4 text-primary" />
          <AlertDescription className="text-sm">
            <strong>{groups.length} student{groups.length !== 1 ? 's' : ''} detected</strong> • Grading separately
            {needsReviewCount > 0 && (
              <span className="text-orange-600 ml-2">
                ({needsReviewCount} need{needsReviewCount !== 1 ? '' : 's'} review)
              </span>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Multiple Students Warning */}
      {multipleStudentsWarning && (
        <Alert className="border-destructive/50 bg-destructive/5">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <AlertDescription className="text-sm text-destructive">
            <strong>Warning:</strong> {multipleStudentsWarning}
          </AlertDescription>
        </Alert>
      )}

      {/* Progress Bar */}
      {isExtracting && (
        <div className="space-y-1">
          <Progress value={progress} className="h-2" />
          <p className="text-xs text-muted-foreground text-center">
            Processing files... {Math.round(progress)}%
          </p>
        </div>
      )}

      {/* Pending Pages (still being processed) */}
      {hasPending && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
            <span className="text-sm font-medium text-muted-foreground">
              Processing ({pendingPages.length} file{pendingPages.length !== 1 ? 's' : ''})
            </span>
          </div>
          
          <div className="border border-dashed border-muted-foreground/30 rounded-lg p-2 space-y-1">
            {pendingPages.map((page) => (
              <div
                key={page.id}
                className="flex items-center gap-2 p-2 rounded bg-muted/10"
              >
                <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{page.originalFileName}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatFileSize(page.size)}
                  </p>
                </div>
                
                <StatusBadge status={page.status} />
                
                <div className="flex items-center gap-1">
                  {page.status === 'failed' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onRetryPendingExtraction(page.id)}
                      className="h-7 w-7 p-0 text-primary"
                      title="Retry"
                    >
                      <RefreshCw className="w-3 h-3" />
                    </Button>
                  )}
                  
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRemovePendingPage(page.id)}
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                    title="Remove"
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Grouped Students */}
      {hasGroups && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-foreground">
              Student Submissions ({groups.length})
            </span>
          </div>

          {/* Grade report confirmation */}
          {!isExtracting && groups.length > 0 && (
            <Alert className="border-primary/30 bg-primary/5">
              <Check className="h-4 w-4 text-primary" />
              <AlertDescription className="text-sm text-primary">
                <strong>Each student will receive an individual grade report</strong> with unique score, strengths, areas for growth, and feedback.
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-3">
            {groups.map(group => (
              <GroupCard
                key={group.groupId}
                group={group}
                onRename={(newName) => onRenameStudent(group.groupId, newName)}
                onRemovePage={(pageId) => onRemovePage(group.groupId, pageId)}
                onDelete={() => onDeleteGroup(group.groupId)}
                onRetryPage={(pageId) => onRetryExtraction(group.groupId, pageId)}
                onShowExtractedText={(page) => handleShowExtractedText(page, group.studentName)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Extracted Text Viewer */}
      <ExtractedTextSheet 
        page={textViewPage} 
        studentName={textViewStudentName}
        onClose={() => setTextViewPage(null)} 
      />
    </div>
  );
}
