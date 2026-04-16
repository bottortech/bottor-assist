import { Upload, Sparkles, PenLine, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type StepKey = "upload" | "generate" | "review";

interface StepGuideProps {
  activeStep: StepKey;
  completed: Partial<Record<StepKey, boolean>>;
}

const STEPS: { key: StepKey; label: string; icon: typeof Upload }[] = [
  { key: "upload", label: "Input student work", icon: Upload },
  { key: "generate", label: "Generate feedback", icon: Sparkles },
  { key: "review", label: "Review & edit", icon: PenLine },
];

/**
 * Sticky 3-step guide rail. Purely visual — does not change grading logic.
 * Highlights the current step and shows a check on completed steps.
 */
export function StepGuide({ activeStep, completed }: StepGuideProps) {
  return (
    <div
      className="sticky top-[73px] z-[9] bg-background/90 backdrop-blur-sm border-b border-border"
      role="navigation"
      aria-label="Grading workflow steps"
    >
      <div className="max-w-2xl mx-auto px-12 py-3">
        <ol className="flex items-center justify-between gap-2">
          {STEPS.map((step, idx) => {
            const Icon = step.icon;
            const isActive = step.key === activeStep;
            const isDone = !!completed[step.key];
            return (
              <li key={step.key} className="flex items-center gap-2 flex-1 min-w-0">
                <div
                  className={cn(
                    "flex items-center gap-2 transition-colors",
                    isActive
                      ? "text-primary"
                      : isDone
                        ? "text-foreground"
                        : "text-muted-foreground/60",
                  )}
                >
                  <div
                    className={cn(
                      "flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold border transition-all",
                      isActive
                        ? "border-primary bg-primary text-primary-foreground shadow-sm"
                        : isDone
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border bg-muted text-muted-foreground",
                    )}
                    aria-current={isActive ? "step" : undefined}
                  >
                    {isDone ? <Check className="w-3.5 h-3.5" /> : idx + 1}
                  </div>
                  <span
                    className={cn(
                      "text-xs sm:text-sm font-medium truncate",
                      isActive && "text-primary",
                    )}
                  >
                    <Icon className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
                    {step.label}
                  </span>
                </div>
                {idx < STEPS.length - 1 && (
                  <div
                    className={cn(
                      "flex-1 h-px transition-colors",
                      isDone ? "bg-primary/40" : "bg-border",
                    )}
                    aria-hidden
                  />
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
