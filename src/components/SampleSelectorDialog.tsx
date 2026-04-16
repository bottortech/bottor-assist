/**
 * =============================================================================
 * SAMPLE SELECTOR DIALOG
 * =============================================================================
 *
 * Two-step (Subject → Grade Band) picker invoked from Step 1: Student Work
 * via the "Try sample files" link. On confirm, calls onSelect with the
 * matching sample so the host page can populate the upload area + rubric.
 * =============================================================================
 */

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { BookOpen, Check } from "lucide-react";
import {
  SAMPLE_SUBJECTS,
  SAMPLE_GRADE_BANDS,
  findSample,
  getAvailableGradeBands,
  type SampleSubject,
  type SampleGradeBandKey,
  type SampleV2,
} from "@/data/useSampleLibraryV2";

interface SampleSelectorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (sample: SampleV2) => void;
}

export function SampleSelectorDialog({ open, onOpenChange, onSelect }: SampleSelectorDialogProps) {
  const [subject, setSubject] = useState<SampleSubject | null>(null);
  const [gradeBand, setGradeBand] = useState<SampleGradeBandKey | null>(null);

  useEffect(() => {
    if (!open) {
      setSubject(null);
      setGradeBand(null);
    }
  }, [open]);

  const availableBands = subject ? getAvailableGradeBands(subject) : [];
  const sample = subject && gradeBand ? findSample(subject, gradeBand) : undefined;

  const handleLoad = () => {
    if (!sample) return;
    onSelect(sample);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-primary" />
            Try sample student work
          </DialogTitle>
          <DialogDescription>
            Pick a subject and grade band — we'll load a real-style assignment, student submission, and rubric so you can run the full grading flow.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Step A: Subject */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Subject</Label>
            <div className="grid grid-cols-2 gap-2">
              {SAMPLE_SUBJECTS.map((s) => {
                const selected = subject === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setSubject(s);
                      setGradeBand(null);
                    }}
                    className={`text-sm h-10 rounded-[10px] border transition-colors px-3 ${
                      selected
                        ? "border-primary bg-accent-light text-primary font-medium"
                        : "border-border hover:border-primary/40 hover:bg-muted/40"
                    }`}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step B: Grade Band */}
          <div className="space-y-2">
            <Label className={`text-sm font-medium ${!subject ? "text-muted-foreground" : ""}`}>
              Grade band
            </Label>
            <div className="grid grid-cols-2 gap-2">
              {SAMPLE_GRADE_BANDS.map(({ key, label }) => {
                const enabled = !!subject && availableBands.includes(key);
                const selected = gradeBand === key;
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={!enabled}
                    onClick={() => setGradeBand(key)}
                    className={`text-sm h-10 rounded-[10px] border transition-colors px-3 ${
                      selected
                        ? "border-primary bg-accent-light text-primary font-medium"
                        : enabled
                        ? "border-border hover:border-primary/40 hover:bg-muted/40"
                        : "border-border bg-muted/20 text-muted-foreground/50 cursor-not-allowed"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {subject && availableBands.length === 0 && (
              <p className="text-xs text-muted-foreground">No samples available yet for {subject}.</p>
            )}
          </div>

          {/* Preview */}
          {sample && (
            <div className="rounded-[10px] border border-border bg-muted/30 p-3 space-y-1">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Preview</p>
              <p className="text-sm font-medium text-foreground">{sample.assignmentTitle}</p>
              <p className="text-xs text-muted-foreground">
                {sample.assignmentType} · {sample.studentName}
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="hero" onClick={handleLoad} disabled={!sample}>
            <Check className="w-4 h-4 mr-2" />
            Load sample
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
