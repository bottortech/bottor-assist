/**
 * =============================================================================
 * ELA Results Display Component
 * =============================================================================
 * 
 * Displays ELA/Writing grading results with:
 * - Large score display
 * - Rubric breakdown table with progress bars
 * - Strengths (green)
 * - Areas for Improvement (orange)
 * - Next Step (blue)
 * - Collapsible notes section
 */

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  CheckCircle2,
  ArrowRight,
  Target,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Copy,
  Check,
} from "lucide-react";
import type { ELAGradeResponse } from "@/types/elaGrading";

interface ELAResultsDisplayProps {
  result: ELAGradeResponse;
  onCopy?: (text: string, label: string) => void;
}

export function ELAResultsDisplay({ result, onCopy }: ELAResultsDisplayProps) {
  const [notesOpen, setNotesOpen] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const handleCopy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedField(label);
    onCopy?.(text, label);
    setTimeout(() => setCopiedField(null), 2000);
  };

  // Get letter grade color
  const getGradeColor = (grade?: string) => {
    if (!grade) return "text-muted-foreground";
    const letter = grade.charAt(0).toUpperCase();
    switch (letter) {
      case "A": return "text-emerald-600 dark:text-emerald-400";
      case "B": return "text-blue-600 dark:text-blue-400";
      case "C": return "text-amber-600 dark:text-amber-400";
      case "D": return "text-orange-600 dark:text-orange-400";
      case "F": return "text-red-600 dark:text-red-400";
      default: return "text-muted-foreground";
    }
  };

  // Get confidence badge variant
  const getConfidenceBadge = (confidence: number) => {
    if (confidence >= 80) {
      return { variant: "default" as const, label: "High Confidence" };
    } else if (confidence >= 60) {
      return { variant: "secondary" as const, label: "Medium Confidence" };
    } else {
      return { variant: "outline" as const, label: "Low Confidence" };
    }
  };

  const confidenceBadge = getConfidenceBadge(result.confidence);

  return (
    <Card className="border-2">
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-xl">{result.student_name}</CardTitle>
            <Badge variant={confidenceBadge.variant} className="mt-2">
              {confidenceBadge.label}
            </Badge>
          </div>
          
          {/* Score Display */}
          <div className="text-right">
            <div className="text-4xl font-bold tracking-tight">
              {result.score}
            </div>
            {result.letter_grade && (
              <div className={`text-2xl font-semibold ${getGradeColor(result.letter_grade)}`}>
                {result.letter_grade}
              </div>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Rubric Breakdown Table */}
        {result.criterion_breakdown && result.criterion_breakdown.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Rubric Breakdown
            </h4>
            <div className="space-y-3">
              {result.criterion_breakdown.map((criterion, idx) => {
                const percent = criterion.possible > 0 
                  ? (criterion.earned / criterion.possible) * 100 
                  : 0;
                
                return (
                  <div key={idx} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{criterion.criterion}</span>
                      <div className="flex items-center gap-2">
                        {criterion.level && (
                          <Badge variant="outline" className="text-xs">
                            {criterion.level}
                          </Badge>
                        )}
                        <span className="font-semibold tabular-nums">
                          {criterion.earned}/{criterion.possible}
                        </span>
                      </div>
                    </div>
                    <Progress value={percent} className="h-2" />
                    {criterion.evidence && (
                      <p className="text-xs text-muted-foreground italic pl-1">
                        "{criterion.evidence}"
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Divider */}
        <div className="border-t" />

        {/* Strengths Section */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            <h4 className="text-sm font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wide">
              Strengths
            </h4>
          </div>
          <ul className="space-y-1.5 pl-7">
            {result.strengths.map((strength, idx) => (
              <li key={idx} className="text-sm flex items-start gap-2">
                <span className="text-emerald-500 mt-1.5">•</span>
                <span>{strength}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Areas for Improvement Section */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <ArrowRight className="w-5 h-5 text-orange-500" />
            <h4 className="text-sm font-semibold text-orange-700 dark:text-orange-400 uppercase tracking-wide">
              Areas for Improvement
            </h4>
          </div>
          <ul className="space-y-1.5 pl-7">
            {result.areas_for_improvement.map((area, idx) => (
              <li key={idx} className="text-sm flex items-start gap-2">
                <span className="text-orange-500 mt-1.5">•</span>
                <span>{area}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Next Step Section */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Target className="w-5 h-5 text-blue-500" />
            <h4 className="text-sm font-semibold text-blue-700 dark:text-blue-400 uppercase tracking-wide">
              Next Step
            </h4>
          </div>
          <div className="pl-7">
            <p className="text-sm bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
              {result.next_step}
            </p>
          </div>
        </div>

        {/* Copy Feedback Button */}
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const feedbackText = `
Strengths:
${result.strengths.map(s => `• ${s}`).join('\n')}

Areas for Improvement:
${result.areas_for_improvement.map(a => `• ${a}`).join('\n')}

Next Step:
${result.next_step}
              `.trim();
              handleCopy(feedbackText, "Feedback");
            }}
          >
            {copiedField === "Feedback" ? (
              <Check className="w-4 h-4 mr-2" />
            ) : (
              <Copy className="w-4 h-4 mr-2" />
            )}
            {copiedField === "Feedback" ? "Copied!" : "Copy Feedback"}
          </Button>
        </div>

        {/* Collapsible Notes Section */}
        {(result.teacher_notes || result.confidence < 70) && (
          <Collapsible open={notesOpen} onOpenChange={setNotesOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="w-full justify-between">
                <span className="text-sm text-muted-foreground">Notes & Details</span>
                {notesOpen ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <div className="space-y-3 p-3 bg-muted/30 rounded-lg text-sm">
                {/* Confidence Score */}
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Confidence Score:</span>
                  <span className="font-medium">{result.confidence}%</span>
                </div>
                
                {/* Low Confidence Warning */}
                {result.confidence < 70 && (
                  <div className="flex items-start gap-2 p-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md">
                    <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      Lower confidence score. Please review carefully before sharing with student or parent.
                    </p>
                  </div>
                )}

                {/* Rubric Info */}
                {result.rubric_used && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Rubric Used:</span>
                    <span className="font-medium">
                      {result.rubric_used.criteria_count} criteria, {result.rubric_used.scale} points
                      <Badge variant="outline" className="ml-2 text-xs">
                        {result.rubric_used.source}
                      </Badge>
                    </span>
                  </div>
                )}

                {/* Teacher Notes */}
                {result.teacher_notes && (
                  <div className="space-y-1">
                    <span className="text-muted-foreground">Teacher Notes:</span>
                    <p className="text-foreground">{result.teacher_notes}</p>
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}
