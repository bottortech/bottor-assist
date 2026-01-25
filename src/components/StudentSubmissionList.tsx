/**
 * StudentSubmissionList Component
 * 
 * Displays ungrouped files and student submissions.
 * Supports:
 * - Creating students from ungrouped files
 * - Renaming students
 * - Moving files between submissions
 * - Unassigning files back to ungrouped pool
 * - Large preview panel for identifying handwriting
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
  Undo2,
  UserPlus,
  AlertTriangle,
  Eye,
  ZoomIn,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { StudentSubmission, UploadedFileItem, FileStatus } from '@/hooks/useStudentSubmissions';

interface StudentSubmissionListProps {
  ungroupedFiles: UploadedFileItem[];
  submissions: StudentSubmission[];
  onCreateStudentWithFiles: (studentName: string, fileIds: string[]) => void;
  onAssignFilesToStudent: (submissionId: string, fileIds: string[]) => void;
  onUnassignFiles: (submissionId: string, fileIds: string[]) => void;
  onRemoveUngroupedFile: (fileId: string) => void;
  onRetryUngroupedFile: (fileId: string) => void;
  onRename: (submissionId: string, newName: string) => void;
  onMoveFile: (fromSubmissionId: string, toSubmissionId: string, fileId: string) => void;
  onRemoveFile: (submissionId: string, fileId: string) => void;
  onRetryFile: (submissionId: string, fileId: string) => void;
  onDeleteSubmission: (submissionId: string) => void;
  allFilesAssigned: boolean;
  isExtracting: boolean;
  progress: number;
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

interface FilePreviewInfo {
  file: UploadedFileItem;
  studentName?: string;
  pageNumber?: number;
}

function FilePreviewDialog({ 
  previewFile, 
  onClose 
}: { 
  previewFile: FilePreviewInfo | null; 
  onClose: () => void;
}) {
  const [showExtractedText, setShowExtractedText] = useState(false);
  
  if (!previewFile) return null;
  
  const { file, studentName, pageNumber } = previewFile;
  const isPdf = file.mimeType === 'application/pdf' || file.fileName.toLowerCase().endsWith('.pdf');
  
  // Build PDF data URL from base64 if available
  const pdfDataUrl = isPdf && file.dataUrl ? file.dataUrl : null;
  
  return (
    <Dialog open={!!previewFile} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <span className="truncate">{file.fileName}</span>
            {studentName && (
              <Badge className="bg-primary/20 text-primary">
                <User className="w-3 h-3 mr-1" />
                {studentName}
                {pageNumber !== undefined && ` • Page ${pageNumber}`}
              </Badge>
            )}
            {!studentName && (
              <Badge variant="outline" className="border-orange-500 text-orange-600">
                Ungrouped
              </Badge>
            )}
            {file.extractedText && (
              <Button
                variant="outline"
                size="sm"
                className="ml-auto h-7 text-xs"
                onClick={() => setShowExtractedText(!showExtractedText)}
              >
                <FileText className="w-3 h-3 mr-1" />
                {showExtractedText ? 'Hide' : 'Show'} Extracted Text
              </Button>
            )}
          </DialogTitle>
        </DialogHeader>
        
        <div className="flex-1 flex gap-3 min-h-[500px] overflow-hidden">
          {/* Primary: Document Preview */}
          <div className={cn(
            "flex-1 overflow-hidden bg-muted/30 rounded-lg",
            showExtractedText && file.extractedText ? "w-1/2" : "w-full"
          )}>
            {file.thumbnailUrl && !isPdf ? (
              <img 
                src={file.thumbnailUrl} 
                alt={file.fileName}
                className="w-full h-full object-contain rounded"
              />
            ) : isPdf && pdfDataUrl ? (
              <iframe
                src={`${pdfDataUrl}#toolbar=1&navpanes=0&scrollbar=1`}
                className="w-full h-full rounded border-0"
                title={`PDF Preview: ${file.fileName}`}
              />
            ) : isPdf ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground space-y-2 p-4">
                <FileText className="w-16 h-16 text-destructive/50" />
                <p className="text-sm font-medium">PDF preview loading...</p>
                <p className="text-xs text-center">
                  If preview doesn't load, check the extracted text below for content verification.
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground space-y-2">
                <Image className="w-16 h-16" />
                <p className="text-sm">Preview not available</p>
              </div>
            )}
          </div>
          
          {/* Secondary: Extracted Text Panel (toggleable) */}
          {showExtractedText && file.extractedText && (
            <div className="w-1/2 flex flex-col bg-muted/20 rounded-lg border overflow-hidden">
              <div className="px-3 py-2 bg-muted/50 border-b flex items-center gap-2">
                <FileText className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">Extracted Text</span>
              </div>
              <div className="flex-1 overflow-auto p-3">
                <p className="text-sm whitespace-pre-wrap leading-relaxed">{file.extractedText}</p>
              </div>
            </div>
          )}
        </div>
        
        {/* Compact extracted text hint when panel is hidden */}
        {!showExtractedText && file.extractedText && (
          <div className="mt-2 p-2 bg-muted/30 rounded-lg flex items-center gap-2">
            <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <p className="text-xs text-muted-foreground truncate flex-1">
              {file.extractedText.substring(0, 100)}...
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={() => setShowExtractedText(true)}
            >
              View Full Text
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FileThumbnail({ 
  file, 
  size = 'sm',
  onClick,
  showPreviewHint = false,
}: { 
  file: UploadedFileItem; 
  size?: 'sm' | 'md';
  onClick?: (e?: React.MouseEvent) => void;
  showPreviewHint?: boolean;
}) {
  const sizeClasses = size === 'md' ? 'w-12 h-12' : 'w-8 h-8';
  const iconSize = size === 'md' ? 'w-6 h-6' : 'w-4 h-4';
  
  if (file.thumbnailUrl) {
    return (
      <div 
        className={cn(
          sizeClasses, 
          "rounded overflow-hidden bg-muted flex-shrink-0 relative group",
          onClick && "cursor-pointer"
        )}
        onClick={onClick}
      >
        <img 
          src={file.thumbnailUrl} 
          alt={file.fileName}
          className="w-full h-full object-cover"
        />
        {showPreviewHint && onClick && (
          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <ZoomIn className="w-4 h-4 text-white" />
          </div>
        )}
      </div>
    );
  }
  
  const isPdf = file.mimeType === 'application/pdf' || file.fileName.toLowerCase().endsWith('.pdf');
  
  return (
    <div 
      className={cn(
        sizeClasses, 
        "rounded bg-muted flex items-center justify-center flex-shrink-0",
        onClick && "cursor-pointer hover:bg-muted/80"
      )}
      onClick={onClick}
    >
      {isPdf ? (
        <FileText className={cn(iconSize, "text-destructive")} />
      ) : (
        <Image className={cn(iconSize, "text-muted-foreground")} />
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
  onUnassignFile: (fileId: string) => void;
  onRemoveFile: (fileId: string) => void;
  onRetryFile: (fileId: string) => void;
  onDelete: () => void;
  onPreviewFile: (file: UploadedFileItem, pageNumber: number) => void;
}

function SubmissionCard({
  submission,
  allSubmissions,
  onRename,
  onMoveFile,
  onUnassignFile,
  onRemoveFile,
  onRetryFile,
  onDelete,
  onPreviewFile,
}: SubmissionCardProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(submission.studentName);

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

  const otherSubmissions = allSubmissions.filter(s => s.id !== submission.id);

  return (
    <div className={cn(
      "border rounded-lg overflow-hidden transition-colors",
      failedCount > 0 ? "border-destructive/30" : "border-primary/30 bg-primary/5"
    )}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        {/* Header */}
        <div className="flex items-center gap-2 p-3 bg-primary/10">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
              {isOpen ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </Button>
          </CollapsibleTrigger>

          <User className="w-4 h-4 text-primary" />

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

          <Badge variant="outline" className="text-xs">
            {submission.files.length} page{submission.files.length !== 1 ? 's' : ''}
          </Badge>

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
            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            title="Remove student (returns files to ungrouped)"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>

        <CollapsibleContent>
          {/* File List */}
          <div className="p-2 space-y-1">
            {submission.files.map((file, idx) => {
              const pageNumber = idx + 1;
              
              return (
                <div
                  key={file.id}
                  className={cn(
                    "flex items-center gap-2 p-2 rounded transition-colors group",
                    file.status === 'failed' 
                      ? "bg-destructive/5"
                      : file.status === 'ready'
                      ? "bg-background hover:bg-muted/30"
                      : "bg-muted/10"
                  )}
                >
                  <GripVertical className="w-3 h-3 text-muted-foreground/50" />
                  
                  {/* Page number badge */}
                  <Badge variant="secondary" className="text-xs px-1.5 py-0 h-5 bg-primary/10 text-primary">
                    Page {pageNumber}
                  </Badge>
                  
                  <FileThumbnail 
                    file={file} 
                    size="md"
                    onClick={() => onPreviewFile(file, pageNumber)}
                    showPreviewHint
                  />
                  
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{file.fileName}</p>
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-muted-foreground">
                        {formatFileSize(file.size)}
                      </p>
                      {/* Assigned badge */}
                      <Badge className="text-[10px] px-1.5 py-0 h-4 bg-primary/20 text-primary">
                        <User className="w-2 h-2 mr-0.5" />
                        {submission.studentName}
                      </Badge>
                    </div>
                  </div>
                  
                  {/* Preview button */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onPreviewFile(file, pageNumber)}
                    className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-primary"
                    title="Preview page"
                  >
                    <Eye className="w-4 h-4" />
                  </Button>
                  
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

                  {/* Move to another student */}
                  {otherSubmissions.length > 0 && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-muted-foreground"
                          title="Move to another student"
                        >
                          <ArrowRight className="w-3 h-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="bg-popover">
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

                  {/* Unassign back to ungrouped */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onUnassignFile(file.id)}
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-orange-500"
                    title="Unassign (move back to ungrouped)"
                  >
                    <Undo2 className="w-3 h-3" />
                  </Button>
                  
                  {file.status !== 'extracting' && file.status !== 'uploading' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onRemoveFile(file.id)}
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      title="Remove permanently"
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              </div>
              );
            })}

            {submission.files.length === 0 && (
              <div className="text-center py-4 text-sm text-muted-foreground">
                No files assigned to this student.
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

export function StudentSubmissionList({
  ungroupedFiles,
  submissions,
  onCreateStudentWithFiles,
  onAssignFilesToStudent,
  onUnassignFiles,
  onRemoveUngroupedFile,
  onRetryUngroupedFile,
  onRename,
  onMoveFile,
  onRemoveFile,
  onRetryFile,
  onDeleteSubmission,
  allFilesAssigned,
  isExtracting,
  progress,
}: StudentSubmissionListProps) {
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [newStudentName, setNewStudentName] = useState('');
  const [showAddStudent, setShowAddStudent] = useState(false);
  const [previewFile, setPreviewFile] = useState<FilePreviewInfo | null>(null);

  const handlePreviewUngroupedFile = (file: UploadedFileItem) => {
    setPreviewFile({ file });
  };

  const handlePreviewAssignedFile = (file: UploadedFileItem, studentName: string, pageNumber: number) => {
    setPreviewFile({ file, studentName, pageNumber });
  };

  const closePreview = () => {
    setPreviewFile(null);
  };

  const toggleFileSelection = (fileId: string) => {
    setSelectedFileIds(prev => 
      prev.includes(fileId) 
        ? prev.filter(id => id !== fileId)
        : [...prev, fileId]
    );
  };

  const selectAllUngrouped = () => {
    const readyIds = ungroupedFiles.filter(f => f.status === 'ready').map(f => f.id);
    setSelectedFileIds(readyIds);
  };

  const clearSelection = () => {
    setSelectedFileIds([]);
  };

  const handleCreateStudent = () => {
    if (selectedFileIds.length === 0) return;
    onCreateStudentWithFiles(newStudentName || `Student ${submissions.length + 1}`, selectedFileIds);
    setSelectedFileIds([]);
    setNewStudentName('');
    setShowAddStudent(false);
  };

  const handleAssignToExisting = (submissionId: string) => {
    if (selectedFileIds.length === 0) return;
    onAssignFilesToStudent(submissionId, selectedFileIds);
    setSelectedFileIds([]);
  };

  const hasUngroupedFiles = ungroupedFiles.length > 0;
  const hasSubmissions = submissions.length > 0;
  const readyUngroupedCount = ungroupedFiles.filter(f => f.status === 'ready').length;

  if (!hasUngroupedFiles && !hasSubmissions) return null;
  
  return (
    <div className="space-y-6">
      {/* Global Progress Bar */}
      {isExtracting && (
        <div className="space-y-1">
          <Progress value={progress} className="h-2" />
          <p className="text-xs text-muted-foreground text-center">
            Processing files... {Math.round(progress)}%
          </p>
        </div>
      )}

      {/* STEP 1: Ungrouped Files Section */}
      {hasUngroupedFiles && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-orange-500" />
              <span className="text-sm font-medium text-orange-600">
                Ungrouped Pages ({ungroupedFiles.length})
              </span>
              <Badge variant="outline" className="text-xs border-orange-500 text-orange-600">
                Required: Assign to students
              </Badge>
            </div>
            {readyUngroupedCount > 0 && (
              <div className="flex gap-2">
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={selectAllUngrouped}
                  className="text-xs"
                >
                  Select all ready
                </Button>
                {selectedFileIds.length > 0 && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={clearSelection}
                    className="text-xs"
                  >
                    Clear
                  </Button>
                )}
              </div>
            )}
          </div>

          <Alert className="border-orange-500/30 bg-orange-500/5">
            <AlertTriangle className="h-4 w-4 text-orange-500" />
            <AlertDescription className="text-sm text-orange-700">
              <strong>Pilot Mode:</strong> All pages must be assigned to students before grading. 
              Select pages below, then create a student or assign to an existing one.
              <br />
              <span className="text-xs">💡 Tip: Click a page to preview handwriting or student name before assigning.</span>
            </AlertDescription>
          </Alert>

          {/* Ungrouped File Grid */}
          <div className="border-2 border-dashed border-orange-500/30 rounded-lg p-3 bg-orange-500/5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {ungroupedFiles.map((file) => {
                const isSelected = selectedFileIds.includes(file.id);
                const isReady = file.status === 'ready';
                
                return (
                  <div
                    key={file.id}
                    className={cn(
                      "flex items-center gap-2 p-2 rounded border transition-all cursor-pointer",
                      isSelected 
                        ? "border-primary bg-primary/10" 
                        : "border-border bg-background hover:border-primary/50",
                      !isReady && "opacity-60"
                    )}
                    onClick={() => isReady && toggleFileSelection(file.id)}
                  >
                    {isReady && (
                      <Checkbox 
                        checked={isSelected}
                        onCheckedChange={() => toggleFileSelection(file.id)}
                        className="data-[state=checked]:bg-primary"
                      />
                    )}
                    
                    <FileThumbnail 
                      file={file} 
                      size="md"
                      onClick={(e) => {
                        e?.stopPropagation();
                        handlePreviewUngroupedFile(file);
                      }}
                      showPreviewHint
                    />
                    
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{file.fileName}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatFileSize(file.size)}
                      </p>
                    </div>
                    
                    {/* Preview button */}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePreviewUngroupedFile(file);
                      }}
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-primary"
                      title="Preview page"
                    >
                      <Eye className="w-4 h-4" />
                    </Button>
                    
                    <StatusBadge status={file.status} />
                    
                    <div className="flex items-center gap-1">
                      {file.status === 'failed' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRetryUngroupedFile(file.id);
                          }}
                          className="h-7 w-7 p-0 text-primary"
                        >
                          <RefreshCw className="w-3 h-3" />
                        </Button>
                      )}
                      
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveUngroupedFile(file.id);
                        }}
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Assignment Actions */}
          {selectedFileIds.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 p-3 bg-primary/5 rounded-lg border border-primary/20">
              <Badge className="bg-primary text-primary-foreground">
                {selectedFileIds.length} page{selectedFileIds.length !== 1 ? 's' : ''} selected
              </Badge>
              
              <div className="flex-1" />
              
              {/* Assign to existing student */}
              {submissions.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      <ArrowRight className="w-4 h-4 mr-1" />
                      Assign to existing
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="bg-popover">
                    {submissions.map(sub => (
                      <DropdownMenuItem
                        key={sub.id}
                        onClick={() => handleAssignToExisting(sub.id)}
                      >
                        <User className="w-3 h-3 mr-2" />
                        {sub.studentName} ({sub.files.length} pages)
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              {/* Create new student */}
              {showAddStudent ? (
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Student name..."
                    value={newStudentName}
                    onChange={(e) => setNewStudentName(e.target.value)}
                    className="h-8 w-40"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateStudent();
                      if (e.key === 'Escape') setShowAddStudent(false);
                    }}
                  />
                  <Button size="sm" onClick={handleCreateStudent}>
                    <Check className="w-4 h-4" />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => setShowAddStudent(false)}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ) : (
                <Button size="sm" onClick={() => setShowAddStudent(true)}>
                  <UserPlus className="w-4 h-4 mr-1" />
                  Create new student
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {/* STEP 2: Assigned Students Section */}
      {hasSubmissions && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium text-foreground">
                Assigned Students ({submissions.length})
              </span>
              {allFilesAssigned && (
                <Badge className="bg-primary/20 text-primary text-xs">
                  ✓ All pages assigned
                </Badge>
              )}
            </div>
          </div>

          <div className="space-y-3">
            {submissions.map(submission => (
              <SubmissionCard
                key={submission.id}
                submission={submission}
                allSubmissions={submissions}
                onRename={(newName) => onRename(submission.id, newName)}
                onMoveFile={(toId, fileId) => onMoveFile(submission.id, toId, fileId)}
                onUnassignFile={(fileId) => onUnassignFiles(submission.id, [fileId])}
                onRemoveFile={(fileId) => onRemoveFile(submission.id, fileId)}
                onRetryFile={(fileId) => onRetryFile(submission.id, fileId)}
                onDelete={() => onDeleteSubmission(submission.id)}
                onPreviewFile={(file, pageNumber) => handlePreviewAssignedFile(file, submission.studentName, pageNumber)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Helper text */}
      <p className="text-xs text-muted-foreground">
        💡 Each student is graded separately. Click a page thumbnail to preview handwriting.
      </p>

      {/* Preview Dialog */}
      <FilePreviewDialog previewFile={previewFile} onClose={closePreview} />
    </div>
  );
}
