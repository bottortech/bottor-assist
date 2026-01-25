/**
 * StudentSubmissionList Component
 * 
 * Displays student submissions grouped with files inside each.
 * Supports:
 * - Renaming students
 * - Moving files between submissions
 * - Adding files to existing submissions
 * - Creating new submissions
 * - Visual grouping with clear separation
 */

import { useState, useRef } from 'react';
import { 
  FileText, 
  Loader2, 
  X, 
  RefreshCw, 
  Check, 
  AlertCircle, 
  Clock, 
  Upload, 
  Image,
  User,
  ChevronDown,
  ChevronRight,
  Edit2,
  Plus,
  ArrowRight,
  Trash2,
  GripVertical,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { StudentSubmission, UploadedFileItem, FileStatus } from '@/hooks/useStudentSubmissions';

interface StudentSubmissionListProps {
  submissions: StudentSubmission[];
  onRename: (submissionId: string, newName: string) => void;
  onMoveFile: (fromSubmissionId: string, toSubmissionId: string, fileId: string) => void;
  onRemoveFile: (submissionId: string, fileId: string) => void;
  onRetryFile: (submissionId: string, fileId: string) => void;
  onDeleteSubmission: (submissionId: string) => void;
  onAddFiles: (submissionId: string, files: FileList) => void;
  totalFiles: number;
  completedFiles: number;
  failedFiles: number;
  progress: number;
  isExtracting: boolean;
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

function FileThumbnail({ file }: { file: UploadedFileItem }) {
  if (file.thumbnailUrl) {
    return (
      <div className="w-8 h-8 rounded overflow-hidden bg-muted flex-shrink-0">
        <img 
          src={file.thumbnailUrl} 
          alt={file.fileName}
          className="w-full h-full object-cover"
        />
      </div>
    );
  }
  
  const isPdf = file.mimeType === 'application/pdf' || file.fileName.toLowerCase().endsWith('.pdf');
  
  return (
    <div className="w-8 h-8 rounded bg-muted flex items-center justify-center flex-shrink-0">
      {isPdf ? (
        <FileText className="w-4 h-4 text-destructive" />
      ) : (
        <Image className="w-4 h-4 text-muted-foreground" />
      )}
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface SubmissionCardProps {
  submission: StudentSubmission;
  allSubmissions: StudentSubmission[];
  onRename: (newName: string) => void;
  onMoveFile: (toSubmissionId: string, fileId: string) => void;
  onRemoveFile: (fileId: string) => void;
  onRetryFile: (fileId: string) => void;
  onDelete: () => void;
  onAddFiles: (files: FileList) => void;
}

function SubmissionCard({
  submission,
  allSubmissions,
  onRename,
  onMoveFile,
  onRemoveFile,
  onRetryFile,
  onDelete,
  onAddFiles,
}: SubmissionCardProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(submission.studentName);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const readyCount = submission.files.filter(f => f.status === 'ready').length;
  const failedCount = submission.files.filter(f => f.status === 'failed').length;
  const isExtracting = submission.files.some(f => 
    f.status === 'queued' || f.status === 'uploading' || f.status === 'uploaded' || f.status === 'extracting'
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
      setEditName(submission.studentName);
      setIsEditing(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onAddFiles(e.target.files);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const otherSubmissions = allSubmissions.filter(s => s.id !== submission.id);

  return (
    <div className={cn(
      "border rounded-lg overflow-hidden transition-colors",
      failedCount > 0 ? "border-destructive/30" : "border-border"
    )}>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif"
        onChange={handleFileSelect}
        className="hidden"
      />

      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        {/* Header */}
        <div className="flex items-center gap-2 p-3 bg-muted/30">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
              {isOpen ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </Button>
          </CollapsibleTrigger>

          <User className="w-4 h-4 text-muted-foreground" />

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
              className="font-medium text-sm cursor-pointer hover:text-primary"
              onClick={() => setIsEditing(true)}
            >
              {submission.studentName}
            </span>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 ml-1"
            onClick={() => setIsEditing(true)}
          >
            <Edit2 className="w-3 h-3 text-muted-foreground" />
          </Button>

          <div className="flex-1" />

          <span className="text-xs text-muted-foreground">
            {readyCount}/{submission.files.length} ready
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
            className="h-7 px-2 text-xs"
            onClick={() => fileInputRef.current?.click()}
          >
            <Plus className="w-3 h-3 mr-1" />
            Add Files
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>

        <CollapsibleContent>
          {/* File List */}
          <div className="p-2 space-y-1">
            {submission.files.map((file, idx) => (
              <div
                key={file.id}
                className={cn(
                  "flex items-center gap-2 p-2 rounded transition-colors",
                  file.status === 'failed' 
                    ? "bg-destructive/5"
                    : file.status === 'ready'
                    ? "bg-primary/5"
                    : "bg-muted/10"
                )}
              >
                <GripVertical className="w-3 h-3 text-muted-foreground/50" />
                
                <span className="text-xs text-muted-foreground w-4">
                  {idx + 1}.
                </span>
                
                <FileThumbnail file={file} />
                
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{file.fileName}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatFileSize(file.size)}
                  </p>
                </div>
                
                <StatusBadge status={file.status} />
                
                <div className="flex items-center gap-1">
                  {file.status === 'failed' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onRetryFile(file.id)}
                      className="h-7 w-7 p-0 text-primary"
                      title="Retry"
                    >
                      <RefreshCw className="w-3 h-3" />
                    </Button>
                  )}

                  {/* Move to another submission */}
                  {otherSubmissions.length > 0 && file.status === 'ready' && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-muted-foreground"
                          title="Move to another submission"
                        >
                          <ArrowRight className="w-3 h-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                          Move to:
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {otherSubmissions.map(sub => (
                          <DropdownMenuItem
                            key={sub.id}
                            onClick={() => onMoveFile(sub.id, file.id)}
                          >
                            <User className="w-3 h-3 mr-2" />
                            {sub.studentName}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                  
                  {file.status !== 'extracting' && file.status !== 'uploading' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onRemoveFile(file.id)}
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      title="Remove"
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  )}
                  
                  {(file.status === 'extracting' || file.status === 'uploading') && (
                    <Loader2 className="w-3 h-3 animate-spin text-primary" />
                  )}
                </div>
              </div>
            ))}

            {submission.files.length === 0 && (
              <div className="text-center py-4 text-sm text-muted-foreground">
                No files in this submission.
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-1"
                >
                  Add files
                </Button>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

export function StudentSubmissionList({
  submissions,
  onRename,
  onMoveFile,
  onRemoveFile,
  onRetryFile,
  onDeleteSubmission,
  onAddFiles,
  totalFiles,
  completedFiles,
  failedFiles,
  progress,
  isExtracting,
}: StudentSubmissionListProps) {
  if (submissions.length === 0) return null;
  
  return (
    <div className="space-y-4">
      {/* Header with global progress */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">
          Student Submissions ({submissions.length})
        </span>
        <span className="text-xs text-muted-foreground">
          {completedFiles}/{totalFiles} files ready
          {failedFiles > 0 && (
            <span className="text-destructive ml-1">• {failedFiles} failed</span>
          )}
        </span>
      </div>
      
      {/* Global Progress Bar */}
      {isExtracting && (
        <div className="space-y-1">
          <Progress value={progress} className="h-2" />
          <p className="text-xs text-muted-foreground text-center">
            Processing files... {Math.round(progress)}%
          </p>
        </div>
      )}

      {/* Submissions */}
      <div className="space-y-3">
        {submissions.map(submission => (
          <SubmissionCard
            key={submission.id}
            submission={submission}
            allSubmissions={submissions}
            onRename={(newName) => onRename(submission.id, newName)}
            onMoveFile={(toId, fileId) => onMoveFile(submission.id, toId, fileId)}
            onRemoveFile={(fileId) => onRemoveFile(submission.id, fileId)}
            onRetryFile={(fileId) => onRetryFile(submission.id, fileId)}
            onDelete={() => onDeleteSubmission(submission.id)}
            onAddFiles={(files) => onAddFiles(submission.id, files)}
          />
        ))}
      </div>

      {/* Helper text */}
      <p className="text-xs text-muted-foreground">
        💡 Each submission is graded separately. Click a student name to rename, or use the arrow icon to move files between submissions.
      </p>
    </div>
  );
}
