/**
 * =============================================================================
 * Transparent Result Card — Evidence-Based Grading View
 * =============================================================================
 * 
 * Provides a split-view of student submission alongside grading results,
 * with clickable evidence linking, editable scores, and teacher overrides.
 */

import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  FileText,
  Eye,
  EyeOff,
  ChevronDown,
  CheckCircle2,
  Info,
  PenLine,
  Check,
  X,
  Copy,
  Lock,
  Search,
} from "lucide-react";

interface QuestionBreakdown {
  question_number: number;
  question_text: string;
  possible_points: number;
  earned_points: number;
  answer_correct: boolean;
  work_shown: boolean;
  work_shown_details?: string;
  scoring_reason?: string;
}

interface GradingResult {
  score_suggestion: string;
  score_derivation?: string;
  score_percent?: number;
  letter_grade?: string;
  confidence?: 'high' | 'medium' | 'low';
  rubric_source?: 'teacher' | 'auto-generated';
  grading_mode?: string;
  work_requirement_enforced?: boolean;
  strengths: string;
  areas_for_improvement: string;
  feedback_paragraph: string;
  question_breakdown?: QuestionBreakdown[];
}

interface TransparentResultCardProps {
  studentName: string;
  extractedText: string;
  result: GradingResult;
  isScoring: boolean;
  onUpdateResult: (field: keyof GradingResult, value: string) => void;
  onCopy: (text: string, label: string) => void;
  copied: string | null;
}

export function TransparentResultCard({
  studentName,
  extractedText,
  result,
  isScoring,
  onUpdateResult,
  onCopy,
  copied,
}: TransparentResultCardProps) {
  const [showSubmission, setShowSubmission] = useState(false);
  const [highlightedEvidence, setHighlightedEvidence] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const submissionRef = useRef<HTMLDivElement>(null);

  // Scroll to and highlight evidence in the submission text
  const scrollToEvidence = (evidenceText: string) => {
    if (!showSubmission) setShowSubmission(true);
    setHighlightedEvidence(evidenceText);
    
    // Scroll to evidence after a tick (to allow panel to open)
    setTimeout(() => {
      if (submissionRef.current) {
        const marks = submissionRef.current.querySelectorAll('mark');
        if (marks.length > 0) {
          marks[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }, 100);
  };

  // Clear highlight when submission panel closes
  useEffect(() => {
    if (!showSubmission) setHighlightedEvidence(null);
  }, [showSubmission]);

  // Render submission text with optional highlighting
  const renderSubmissionText = () => {
    if (!highlightedEvidence) {
      return <pre className="text-sm text-foreground whitespace-pre-wrap font-mono leading-relaxed">{extractedText}</pre>;
    }

    // Find and highlight the evidence in text (fuzzy match first 40 chars)
    const searchStr = highlightedEvidence.slice(0, 40).toLowerCase();
    const textLower = extractedText.toLowerCase();
    const idx = textLower.indexOf(searchStr);

    if (idx === -1) {
      // Try individual keywords from evidence
      const keywords = highlightedEvidence.split(/\s+/).filter(w => w.length > 3);
      let bestIdx = -1;
      for (const kw of keywords) {
        const kwIdx = textLower.indexOf(kw.toLowerCase());
        if (kwIdx !== -1) {
          bestIdx = kwIdx;
          break;
        }
      }

      if (bestIdx === -1) {
        return <pre className="text-sm text-foreground whitespace-pre-wrap font-mono leading-relaxed">{extractedText}</pre>;
      }

      // Highlight a region around the keyword
      const start = Math.max(0, bestIdx - 20);
      const end = Math.min(extractedText.length, bestIdx + 80);
      return (
        <pre className="text-sm text-foreground whitespace-pre-wrap font-mono leading-relaxed">
          {extractedText.slice(0, start)}
          <mark className="bg-amber-200 dark:bg-amber-800/60 rounded px-0.5">{extractedText.slice(start, end)}</mark>
          {extractedText.slice(end)}
        </pre>
      );
    }

    // Highlight the matched region
    const end = Math.min(extractedText.length, idx + highlightedEvidence.length + 20);
    return (
      <pre className="text-sm text-foreground whitespace-pre-wrap font-mono leading-relaxed">
        {extractedText.slice(0, idx)}
        <mark className="bg-amber-200 dark:bg-amber-800/60 rounded px-0.5">{extractedText.slice(idx, end)}</mark>
        {extractedText.slice(end)}
      </pre>
    );
  };

  const hasScore = isScoring && result.score_suggestion !== "N/A";

  return (
    <div className="space-y-4">
      {/* ===== Score Header ===== */}
      {hasScore && (
        <Card className="border-2 border-primary/30 shadow-lg bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex justify-between items-center">
              <div className="flex items-center gap-2">
                <span className="text-xl font-bold">Score</span>
                <Badge variant="outline" className="text-xs bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-300">
                  <Lock className="w-3 h-3 mr-1" />
                  Rubric-based scoring
                </Badge>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onCopy(result.score_suggestion, "Score")}
              >
                {copied === "Score" ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-4 py-2">
              <Input
                value={result.score_suggestion}
                onChange={(e) => onUpdateResult("score_suggestion", e.target.value)}
                className="text-3xl font-bold text-primary max-w-36 h-14 text-center border-2 border-primary/20"
              />
              <div className="flex flex-col items-center">
                <span className="text-4xl font-bold text-foreground">
                  {result.score_percent}%
                </span>
                {result.letter_grade && (
                  <Badge variant="secondary" className="text-xl px-4 py-1 mt-1 font-bold">
                    {result.letter_grade}
                  </Badge>
                )}
              </div>
              {/* Teacher override indicator */}
              <div className="ml-auto">
                <Badge variant="outline" className="text-xs text-muted-foreground">
                  <PenLine className="w-3 h-3 mr-1" />
                  Editable — you have final say
                </Badge>
              </div>
            </div>
            {result.score_derivation && (
              <p className="text-sm text-muted-foreground flex items-start gap-2">
                <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                {result.score_derivation}
              </p>
            )}
            {result.confidence && result.confidence !== 'high' && (
              <div className={`flex items-center gap-2 text-xs p-2 rounded-md ${
                result.confidence === 'low'
                  ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                  : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
              }`}>
                <Info className="w-3 h-3" />
                Confidence: {result.confidence} — teacher review recommended
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Feedback-only header when no score */}
      {!hasScore && (
        <Card className="border-2 border-blue-200 dark:border-blue-800 shadow-lg bg-blue-50 dark:bg-blue-900/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <span className="text-xl font-bold">Feedback</span>
              <Badge variant="outline" className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-300">
                Feedback-only mode
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-blue-700 dark:text-blue-300">
              No numeric score generated. Add a rubric to enable scoring.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ===== Document Preview Toggle ===== */}
      <Card className="border shadow-sm">
        <CardContent className="p-0">
          <button
            onClick={() => setShowSubmission(!showSubmission)}
            className="w-full flex items-center justify-between p-4 hover:bg-muted/30 transition-colors rounded-lg"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                <FileText className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="text-left">
                <span className="text-sm font-medium">View Original Submission</span>
                <p className="text-xs text-muted-foreground">
                  {extractedText.split('\n').length} lines · {extractedText.length} characters
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {showSubmission ? (
                <EyeOff className="w-4 h-4 text-muted-foreground" />
              ) : (
                <Eye className="w-4 h-4 text-muted-foreground" />
              )}
              <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${showSubmission ? 'rotate-180' : ''}`} />
            </div>
          </button>

          {showSubmission && (
            <div className="border-t">
              {highlightedEvidence && (
                <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800">
                  <Search className="w-3 h-3 text-amber-600" />
                  <span className="text-xs text-amber-700 dark:text-amber-300">
                    Showing evidence for scoring decision
                  </span>
                  <button
                    onClick={() => setHighlightedEvidence(null)}
                    className="ml-auto text-amber-600 hover:text-amber-800"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}
              <div
                ref={submissionRef}
                className="p-4 max-h-[400px] overflow-y-auto bg-muted/10"
              >
                {renderSubmissionText()}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ===== Question-by-Question Breakdown with Evidence ===== */}
      {result.question_breakdown && result.question_breakdown.length > 0 && (
        <Card className="border shadow-md">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Question-by-Question Breakdown
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Click "View evidence" on any question to see the matching section in the student's work.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {result.question_breakdown.map((q, idx) => (
              <div
                key={idx}
                className={`p-3 rounded-md border transition-colors ${
                  q.earned_points === q.possible_points
                    ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800'
                    : q.answer_correct && !q.work_shown
                      ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
                      : 'bg-muted/30 border-muted'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex flex-col gap-0.5 flex-1">
                    <span className="text-sm font-medium">
                      Question {q.question_number}
                      {q.question_text && (
                        <span className="text-muted-foreground font-normal ml-2">
                          ({q.question_text})
                        </span>
                      )}
                    </span>
                    {q.scoring_reason && (
                      <span className="text-xs text-muted-foreground">
                        {q.scoring_reason}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Evidence link */}
                    {q.scoring_reason && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-primary hover:text-primary/80"
                        onClick={() => {
                          // Search for the question content in original text
                          const searchText = q.question_text || `Problem ${q.question_number}`;
                          scrollToEvidence(searchText);
                        }}
                      >
                        <Search className="w-3 h-3 mr-1" />
                        View evidence
                      </Button>
                    )}
                    <span className={`text-sm font-semibold ${
                      q.earned_points === q.possible_points
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : q.answer_correct && !q.work_shown
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-foreground'
                    }`}>
                      {q.earned_points}/{q.possible_points}
                    </span>
                    {q.answer_correct && !q.work_shown && (
                      <Badge variant="outline" className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-300">
                        No work shown
                      </Badge>
                    )}
                    {q.earned_points === q.possible_points && (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    )}
                  </div>
                </div>
              </div>
            ))}

            {/* Work requirement notice */}
            {result.work_requirement_enforced && result.question_breakdown.some(q => q.answer_correct && !q.work_shown) && (
              <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-md border border-amber-200 dark:border-amber-800">
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  <strong>Note:</strong> Some questions received reduced credit because no work was shown.
                  According to the rubric, showing work is required for full credit.
                </p>
              </div>
            )}

            {result.grading_mode && (
              <div className={`mt-3 p-2 rounded-md text-xs flex items-center gap-2 ${
                result.work_requirement_enforced
                  ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
                  : 'bg-muted/50 text-muted-foreground border border-border'
              }`}>
                <Info className="w-3 h-3" />
                {result.work_requirement_enforced
                  ? 'Grading Mode: Work Required — rubric explicitly requires showing work'
                  : 'Grading Mode: Answer Only — rubric does not require showing work'
                }
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ===== Quick Summary ===== */}
      <Card className="border-0 shadow-md">
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span className="text-sm font-medium text-foreground">Strengths</span>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2">
                {result.strengths?.slice(0, 100) || "See detailed feedback"}
                {(result.strengths?.length || 0) > 100 ? "..." : ""}
              </p>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <span className="text-sm font-medium text-foreground">Areas for Improvement</span>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2">
                {result.areas_for_improvement?.slice(0, 100) || "See detailed feedback"}
                {(result.areas_for_improvement?.length || 0) > 100 ? "..." : ""}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ===== Editable Detailed Feedback ===== */}
      <Collapsible open={feedbackOpen} onOpenChange={setFeedbackOpen}>
        <Card className="border shadow-md">
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/20 transition-colors rounded-t-lg pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <PenLine className="w-5 h-5 text-muted-foreground" />
                  <CardTitle className="text-base font-medium">
                    Edit Feedback & Scores
                  </CardTitle>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">
                    Teacher Override
                  </Badge>
                  <ChevronDown className={`w-5 h-5 text-muted-foreground transition-transform duration-200 ${
                    feedbackOpen ? "rotate-180" : ""
                  }`} />
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>

          <CollapsibleContent>
            <CardContent className="space-y-4 pt-0">
              <p className="text-xs text-muted-foreground border-l-2 border-primary/30 pl-3">
                All fields below are editable. Your changes override the AI suggestions. You always have final authority.
              </p>

              {/* Strengths */}
              <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  Strengths
                </Label>
                <Textarea
                  value={result.strengths}
                  onChange={(e) => onUpdateResult("strengths", e.target.value)}
                  rows={3}
                />
              </div>

              {/* Areas for Improvement */}
              <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <Info className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  Areas for Improvement
                </Label>
                <Textarea
                  value={result.areas_for_improvement}
                  onChange={(e) => onUpdateResult("areas_for_improvement", e.target.value)}
                  rows={3}
                />
              </div>

              {/* Draft Feedback */}
              <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <FileText className="w-4 h-4 text-primary" />
                  Draft Feedback for Student
                </Label>
                <Textarea
                  value={result.feedback_paragraph}
                  onChange={(e) => onUpdateResult("feedback_paragraph", e.target.value)}
                  rows={5}
                />
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </div>
  );
}
