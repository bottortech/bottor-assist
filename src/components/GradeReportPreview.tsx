/**
 * =============================================================================
 * GRADE REPORT PREVIEW COMPONENT
 * =============================================================================
 * 
 * A clean, print-friendly preview of the Grade Report for pilot mode.
 * Displays only the essential report content without UI chrome.
 * 
 * FEATURE FLAG: This component is used in pilot mode. When PILOT_MODE is false,
 * the full PDF download functionality will be enabled instead.
 * =============================================================================
 */

import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { X, Printer, FlaskConical } from 'lucide-react';
import { isPilotMode } from '@/lib/feature-flags';

interface GradeReportData {
  studentName: string;
  assignmentName: string;
  score: string;
  strengths: string;
  areasForImprovement: string;
  feedback: string;
  gradingMode: 'scoring' | 'feedback-only';
  subject?: string;
  gradeLevel?: string;
}

interface GradeReportPreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: GradeReportData;
  onPrint: () => void;
}

export function GradeReportPreview({
  open,
  onOpenChange,
  data,
  onPrint,
}: GradeReportPreviewProps) {
  const formattedDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const showPilotBadge = isPilotMode();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0 gap-0">
        {/* Preview Header Bar */}
        <div className="sticky top-0 z-10 flex items-center justify-between bg-muted/80 backdrop-blur-sm px-4 py-3 border-b">
          <span className="text-sm font-medium text-muted-foreground">
            Grade Report Preview
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onPrint} className="gap-1.5">
              <Printer className="w-3.5 h-3.5" />
              Print / Save Preview
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Report Content - Styled for print */}
        <div className="p-8 bg-white dark:bg-background">
          {/* Pilot Mode Badge */}
          {showPilotBadge && (
            <div className="flex justify-center mb-4">
              <div className="inline-flex flex-col items-center">
                <Badge 
                  variant="secondary" 
                  className="px-3 py-1 text-xs font-medium bg-muted text-muted-foreground border border-border rounded-full"
                >
                  <FlaskConical className="w-3 h-3 mr-1.5" />
                  Pilot Mode
                </Badge>
                <span className="text-[10px] text-muted-foreground mt-1">
                  Feature preview for pilot testing
                </span>
              </div>
            </div>
          )}

          {/* Header */}
          <div className="text-center border-b-2 border-primary pb-4 mb-6">
            <h1 className="text-2xl font-bold text-primary mb-1">Grade Report</h1>
            <p className="text-sm text-muted-foreground">
              Generated on {formattedDate}
            </p>
          </div>

          {/* Meta Information */}
          <div className="grid grid-cols-2 gap-4 bg-muted/30 border border-border rounded-lg p-4 mb-6">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-0.5">
                Student
              </p>
              <p className="font-semibold text-foreground">
                {data.studentName || 'Not specified'}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-0.5">
                Assignment
              </p>
              <p className="font-semibold text-foreground">
                {data.assignmentName || 'Not specified'}
              </p>
            </div>
            {data.subject && (
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-0.5">
                  Subject
                </p>
                <p className="font-semibold text-foreground">{data.subject}</p>
              </div>
            )}
            {data.gradeLevel && (
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-0.5">
                  Grade Level
                </p>
                <p className="font-semibold text-foreground">{data.gradeLevel}</p>
              </div>
            )}
          </div>

          {/* Score Box - Only show in scoring mode */}
          {data.gradingMode === 'scoring' && data.score !== 'N/A' && (
            <div className="bg-gradient-to-br from-primary/10 to-primary/5 border-2 border-primary rounded-xl p-6 text-center mb-6">
              <p className="text-xs text-primary uppercase tracking-widest mb-1">
                Suggested Score <span className="normal-case opacity-70">(AI-assisted)</span>
              </p>
              <p className="text-4xl font-bold text-primary">{data.score}</p>
            </div>
          )}

          {/* Observed Strengths Section */}
          <div className="mb-5">
            <h2 className="text-sm font-semibold text-primary border-b border-border pb-2 mb-3">
              Observed Strengths
            </h2>
            <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
              {data.strengths}
            </p>
          </div>

          {/* Areas for Growth Section */}
          <div className="mb-5">
            <h2 className="text-sm font-semibold text-primary border-b border-border pb-2 mb-3">
              Areas for Growth
            </h2>
            <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
              {data.areasForImprovement}
            </p>
          </div>

          {/* Teacher Feedback Summary Section */}
          <div className="bg-accent/50 border border-accent rounded-lg p-4 mb-6">
            <h2 className="text-sm font-semibold text-accent-foreground border-b border-accent pb-2 mb-3">
              Teacher Feedback Summary
            </h2>
            <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
              {data.feedback}
            </p>
          </div>

          {/* Footer */}
          <div className="mt-8 pt-4 border-t border-border text-center">
            <p className="text-xs text-muted-foreground">
              This report was generated using AI assistance and is intended as a draft for teacher review.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
