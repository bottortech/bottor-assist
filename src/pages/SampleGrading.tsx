/**
 * =============================================================================
 * TRY SAMPLE GRADING PAGE (/samples)
 * =============================================================================
 *
 * PURPOSE: Let teachers explore real grading samples across subjects.
 * Split-panel layout: selection on the left, preview + evaluation on the right.
 * =============================================================================
 */

import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useSampleLibrary } from "@/data/useSampleLibrary";
import type { GradingSample, CriterionScore } from "@/types/sampleLibrary";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  BookOpen,
  Calculator,
  FlaskConical,
  Landmark,
  ChevronRight,
  CheckCircle2,
  Star,
} from "lucide-react";

/* ── subject icon helper ─────────────────────────────────────────────── */
const subjectIcon = (subject: string) => {
  switch (subject) {
    case "ELA":
      return <BookOpen className="w-4 h-4" />;
    case "Math":
      return <Calculator className="w-4 h-4" />;
    case "Science":
      return <FlaskConical className="w-4 h-4" />;
    case "Social Studies":
      return <Landmark className="w-4 h-4" />;
    default:
      return null;
  }
};

const subjectColor = (subject: string) => {
  switch (subject) {
    case "ELA":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "Math":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "Science":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "Social Studies":
      return "bg-purple-50 text-purple-700 border-purple-200";
    default:
      return "bg-muted text-muted-foreground";
  }
};

/* ── score colour helper ─────────────────────────────────────────────── */
function scoreColor(score: number) {
  if (score >= 90) return "text-emerald-600";
  if (score >= 80) return "text-blue-600";
  if (score >= 70) return "text-amber-600";
  return "text-red-600";
}

function scoreBg(score: number) {
  if (score >= 90) return "bg-emerald-50 border-emerald-200";
  if (score >= 80) return "bg-blue-50 border-blue-200";
  if (score >= 70) return "bg-amber-50 border-amber-200";
  return "bg-red-50 border-red-200";
}

/* ── bar width for criterion breakdown ───────────────────────────────── */
function barPct(earned: number, possible: number) {
  if (!possible) return 0;
  return Math.round((earned / possible) * 100);
}

/* ═══════════════════════════════════════════════════════════════════════ */
export default function SampleGrading() {
  const navigate = useNavigate();
  const { allSamples, subjects, gradeBands } = useSampleLibrary();

  /* filters */
  const [subjectFilter, setSubjectFilter] = useState<string>("all");
  const [gradeBandFilter, setGradeBandFilter] = useState<string>("all");

  /* state */
  const [selected, setSelected] = useState<GradingSample | null>(null);
  const [showEvaluation, setShowEvaluation] = useState(false);

  /* derived assignment types */
  const assignmentTypes = useMemo(
    () => [...new Set(allSamples.map((s) => s.assignmentType))],
    [allSamples],
  );

  /* filtered list */
  const filtered = useMemo(() => {
    let list = allSamples;
    if (subjectFilter !== "all") list = list.filter((s) => s.subject === subjectFilter);
    if (gradeBandFilter !== "all") list = list.filter((s) => s.gradeBand.includes(gradeBandFilter));
    return list;
  }, [allSamples, subjectFilter, gradeBandFilter]);

  /* handlers */
  const handleSelect = (sample: GradingSample) => {
    setSelected(sample);
    setShowEvaluation(false);
  };

  /* ── render ────────────────────────────────────────────────────────── */
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AppHeader />

      {/* toolbar */}
      <div className="border-b border-border px-6 py-3 flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/")}
          className="text-muted-foreground hover:text-foreground -ml-2"
        >
          <ArrowLeft className="w-4 h-4 mr-1.5" />
          Home
        </Button>
        <span className="text-sm font-semibold text-foreground">
          Sample Grading Library
        </span>
        <Badge variant="outline" className="ml-auto text-xs font-normal text-muted-foreground">
          {allSamples.length} samples
        </Badge>
      </div>

      {/* main split */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── LEFT: selection panel ──────────────────────────────────── */}
        <aside className="w-[340px] shrink-0 border-r border-border flex flex-col bg-card">
          {/* filters */}
          <div className="px-4 pt-4 pb-3 space-y-3 border-b border-border">
            <Select value={subjectFilter} onValueChange={setSubjectFilter}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="All Subjects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Subjects</SelectItem>
                {subjects.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={gradeBandFilter} onValueChange={setGradeBandFilter}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="All Grade Bands" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Grade Bands</SelectItem>
                {gradeBands.map((g) => (
                  <SelectItem key={g} value={g}>
                    {g}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* sample list */}
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {filtered.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No samples match your filters.
                </p>
              )}
              {filtered.map((sample) => (
                <button
                  key={sample.id}
                  onClick={() => handleSelect(sample)}
                  className={`w-full text-left rounded-lg px-3 py-3 transition-colors ${
                    selected?.id === sample.id
                      ? "bg-primary/10 border border-primary/30"
                      : "hover:bg-muted border border-transparent"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground leading-snug line-clamp-2">
                        {sample.assignmentTitle}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {sample.studentName}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                  </div>
                  <div className="flex items-center gap-1.5 mt-2">
                    <span
                      className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${subjectColor(
                        sample.subject,
                      )}`}
                    >
                      {subjectIcon(sample.subject)}
                      {sample.subject}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {sample.gradeBand.replace(/\(.*\)/, "").trim()}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>
        </aside>

        {/* ── RIGHT: preview panel ──────────────────────────────────── */}
        <main className="flex-1 overflow-y-auto">
          {!selected ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <div className="text-center space-y-2">
                <BookOpen className="w-10 h-10 mx-auto opacity-40" />
                <p className="text-sm">Select a sample to preview</p>
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
              {/* assignment header */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${subjectColor(
                      selected.subject,
                    )}`}
                  >
                    {subjectIcon(selected.subject)}
                    {selected.subject}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {selected.gradeBand}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    · {selected.assignmentType}
                  </span>
                </div>
                <h1 className="text-xl font-bold text-foreground leading-tight">
                  {selected.assignmentTitle}
                </h1>
              </div>

              {/* instructions */}
              <section>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Assignment Instructions
                </h2>
                <div className="bg-muted/50 rounded-xl p-4 text-sm text-secondary-foreground whitespace-pre-line leading-relaxed">
                  {selected.assignmentInstructions}
                </div>
              </section>

              {/* student submission */}
              <section>
                <div className="flex items-baseline justify-between mb-2">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Student Submission
                  </h2>
                  <span className="text-xs text-muted-foreground">
                    {selected.submissionDate}
                  </span>
                </div>
                <div className="border border-border rounded-xl p-5 bg-card">
                  <p className="text-sm font-medium text-foreground mb-1">
                    {selected.studentName}
                  </p>
                  <div className="text-sm text-secondary-foreground whitespace-pre-line leading-relaxed mt-3">
                    {selected.studentSubmission}
                  </div>
                </div>
              </section>

              {/* rubric */}
              <section>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Rubric
                </h2>
                <div className="border border-border rounded-xl divide-y divide-border overflow-hidden">
                  {selected.rubric.criteria.map((c) => (
                    <div key={c.name} className="p-4">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-foreground">
                          {c.name}
                        </span>
                        <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                          {c.weight}%
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {c.rationale}
                      </p>
                    </div>
                  ))}
                </div>
              </section>

              {/* run grading */}
              {!showEvaluation && (
                <div className="pt-2">
                  <Button
                    size="lg"
                    className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
                    onClick={() => setShowEvaluation(true)}
                  >
                    <Star className="w-4 h-4 mr-2" />
                    Run Grading
                  </Button>
                </div>
              )}

              {/* ── evaluation results ─────────────────────────────── */}
              {showEvaluation && (
                <section className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  {/* divider */}
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Evaluation Results
                    </span>
                    <div className="flex-1 h-px bg-border" />
                  </div>

                  {/* score hero */}
                  <div
                    className={`flex items-center gap-6 p-6 rounded-xl border ${scoreBg(
                      selected.evaluation.finalScore,
                    )}`}
                  >
                    <div className="text-center">
                      <p
                        className={`text-4xl font-bold ${scoreColor(
                          selected.evaluation.finalScore,
                        )}`}
                      >
                        {selected.evaluation.finalScore}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        out of 100
                      </p>
                    </div>
                    <div className="h-12 w-px bg-border" />
                    <div>
                      <p
                        className={`text-2xl font-bold ${scoreColor(
                          selected.evaluation.finalScore,
                        )}`}
                      >
                        {selected.evaluation.letterGrade}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Letter Grade
                      </p>
                    </div>
                  </div>

                  {/* criterion breakdown */}
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                      Criterion Breakdown
                    </h3>
                    <div className="border border-border rounded-xl divide-y divide-border overflow-hidden">
                      {selected.evaluation.criterionScores.map(
                        (cs: CriterionScore) => (
                          <div key={cs.criterion} className="p-4">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-medium text-foreground">
                                {cs.criterion}
                              </span>
                              <span className="text-sm font-semibold text-foreground">
                                {cs.weightedPointsEarned}/{cs.weightedPointsPossible}
                              </span>
                            </div>
                            {/* progress bar */}
                            <div className="h-2 bg-muted rounded-full overflow-hidden mb-2">
                              <div
                                className="h-full rounded-full bg-primary transition-all duration-700 ease-out"
                                style={{
                                  width: `${barPct(cs.weightedPointsEarned, cs.weightedPointsPossible)}%`,
                                }}
                              />
                            </div>
                            <p className="text-xs text-muted-foreground leading-relaxed">
                              {cs.scoringNote}
                            </p>
                          </div>
                        ),
                      )}
                    </div>
                  </div>

                  {/* grading rationale */}
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                      Grading Rationale
                    </h3>
                    <div className="bg-muted/50 rounded-xl p-5 text-sm text-secondary-foreground leading-relaxed">
                      {selected.evaluation.gradingRationale}
                    </div>
                  </div>

                  {/* reset */}
                  <div className="flex justify-center pb-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowEvaluation(false)}
                      className="text-muted-foreground"
                    >
                      Hide Evaluation
                    </Button>
                  </div>
                </section>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
