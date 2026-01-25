/**
 * StudentSubmissionList Component
 * 
 * Displays ungrouped files and student submissions.
 * Supports:
 * - Creating students from ungrouped files
 * - Renaming students
 * - Moving files between submissions
 * - Unassigning files back to ungrouped pool
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
  onUnassignFile: (fileId: string) => void;
  onRemoveFile: (fileId: string) => void;
  onRetryFile: (fileId: string) => void;
  onDelete: () => void;
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
            {submission.files.map((file, idx) => (
              <div
                key={file.id}
                className={cn(
                  "flex items-center gap-2 p-2 rounded transition-colors",
                  file.status === 'failed' 
                    ? "bg-destructive/5"
                    : file.status === 'ready'
                    ? "bg-background"
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
            ))}

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
              />
            ))}
          </div>
        </div>
      )}

      {/* Helper text */}
      <p className="text-xs text-muted-foreground">
        💡 Each student is graded separately. Click a student name to rename.
      </p>
    </div>
  );
}
