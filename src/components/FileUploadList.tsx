/**
 * FileUploadList Component
 * 
 * Displays uploaded files with:
 * - Thumbnails for images
 * - Status chips (Queued, Uploading, Uploaded, Extracting, Ready, Failed)
 * - Retry button for failed files
 * - Remove button
 * - Global progress bar
 */

import React from 'react';
import { FileText, Loader2, X, RefreshCw, Check, AlertCircle, Clock, Upload, Image } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { UploadedFileItem, FileStatus } from '@/hooks/useFileUpload';

interface FileUploadListProps {
  files: UploadedFileItem[];
  onRemove: (fileId: string) => void;
  onRetry: (fileId: string) => void;
  label?: string;
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

const StatusBadge = React.forwardRef<HTMLDivElement, { status: FileStatus }>(
  ({ status }, ref) => {
    const config = statusConfig[status];
    const Icon = config.icon;
    const isAnimated = status === 'extracting' || status === 'uploading';
    
    return (
      <Badge 
        ref={ref}
        variant={config.variant}
        className={cn('text-xs px-2 py-0.5 gap-1', config.className)}
      >
        <Icon className={cn('w-3 h-3', isAnimated && 'animate-spin')} />
        {config.label}
      </Badge>
    );
  }
);
StatusBadge.displayName = 'StatusBadge';

function FileThumbnail({ file }: { file: UploadedFileItem }) {
  // Check if file is an image type for potential thumbnail
  const isImage = file.fileType.startsWith('image/');
  const isPdf = file.fileType === 'application/pdf' || file.fileName.toLowerCase().endsWith('.pdf');
  
  return (
    <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
      {isPdf ? (
        <FileText className="w-5 h-5 text-destructive" />
      ) : isImage ? (
        <Image className="w-5 h-5 text-primary" />
      ) : (
        <FileText className="w-5 h-5 text-muted-foreground" />
      )}
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileUploadList({
  files,
  onRemove,
  onRetry,
  label = 'Uploaded Files',
  totalFiles,
  completedFiles,
  failedFiles,
  progress,
  isExtracting,
}: FileUploadListProps) {
  if (files.length === 0) return null;
  
  return (
    <div className="space-y-3">
      {/* Header with progress */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">
          {label} ({files.length})
        </span>
        <span className="text-xs text-muted-foreground">
          {completedFiles}/{totalFiles} ready
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
      
      {/* File List */}
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {files.map((file, idx) => (
          <div
            key={file.id}
            className={cn(
              "flex items-center gap-3 p-3 border rounded-lg transition-colors",
              file.status === 'failed' 
                ? "border-destructive/30 bg-destructive/5"
                : file.status === 'ready'
                ? "border-primary/20 bg-primary/5"
                : "border-border bg-muted/20"
            )}
          >
            {/* Index */}
            <span className="text-xs font-medium text-muted-foreground w-5 text-center flex-shrink-0">
              {idx + 1}.
            </span>
            
            {/* Thumbnail */}
            <FileThumbnail file={file} />
            
            {/* File Info */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{file.fileName}</p>
              <p className="text-xs text-muted-foreground">
                {formatFileSize(file.size)}
              </p>
            </div>
            
            {/* Status Badge */}
            <StatusBadge status={file.status} />
            
            {/* Actions */}
            <div className="flex items-center gap-1 flex-shrink-0">
              {file.status === 'failed' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onRetry(file.id)}
                  className="h-8 w-8 p-0 text-primary hover:text-primary hover:bg-primary/10"
                  title="Retry extraction"
                >
                  <RefreshCw className="w-4 h-4" />
                </Button>
              )}
              
              {file.status !== 'extracting' && file.status !== 'uploading' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onRemove(file.id)}
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                  title="Remove file"
                >
                  <X className="w-4 h-4" />
                </Button>
              )}
              
              {(file.status === 'extracting' || file.status === 'uploading') && (
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
              )}
            </div>
          </div>
        ))}
      </div>
      
      {/* Error hint */}
      {failedFiles > 0 && (
        <p className="text-xs text-muted-foreground">
          💡 Tip: For failed files, you can retry extraction or manually paste the text in the combined text area below.
        </p>
      )}
    </div>
  );
}
