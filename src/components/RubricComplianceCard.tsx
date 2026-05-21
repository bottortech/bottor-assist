/**
 * RubricComplianceCard
 * -----------------------------------------------------------
 * Transparent audit of which rubric criteria the AI actually
 * graded against vs. what the teacher provided. Backend computes
 * `rubric_compliance` deterministically; this component renders it.
 *
 * Status:
 *  - "custom"  → green  · Teacher rubric applied as-is (default collapsed)
 *  - "mixed"   → yellow · Teacher rubric + supplemental criteria (default open)
 *  - "default" → red    · No rubric detected, default fallback used (default open)
 */

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChevronDown, ShieldCheck, AlertTriangle, ShieldAlert } from "lucide-react";

export interface RubricComplianceData {
  status: "custom" | "mixed" | "default";
  rubric_source?: "teacher" | "auto-generated";
  criteria_used: { name: string; source: "teacher" | "default" }[];
  expected_criteria?: string[];
  actual_criteria?: string[];
  mismatches?: { extra: string[]; missing: string[] };
}

interface Props {
  compliance: RubricComplianceData;
}

const STATUS_META = {
  custom: {
    label: "Custom rubric applied",
    dot: "🟢",
    Icon: ShieldCheck,
    badgeClass:
      "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-300",
    cardClass: "border-emerald-200 dark:border-emerald-800",
    defaultOpen: false,
  },
  mixed: {
    label: "Custom rubric + defaults",
    dot: "🟡",
    Icon: AlertTriangle,
    badgeClass:
      "bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 border-amber-300",
    cardClass: "border-amber-300 dark:border-amber-800",
    defaultOpen: true,
  },
  default: {
    label: "Default rubric used",
    dot: "🔴",
    Icon: ShieldAlert,
    badgeClass:
      "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-300",
    cardClass: "border-red-300 dark:border-red-800",
    defaultOpen: true,
  },
} as const;

export function RubricComplianceCard({ compliance }: Props) {
  const meta = STATUS_META[compliance.status];
  const [open, setOpen] = useState(meta.defaultOpen);

  const expected = compliance.expected_criteria ?? [];
  const actual = compliance.actual_criteria ?? [];
  const showComparison =
    compliance.rubric_source === "teacher" && expected.length > 0;

  const norm = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const expectedNorm = expected.map(norm);
  const actualNorm = actual.map(norm);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className={`border-2 shadow-sm ${meta.cardClass}`}>
        <CollapsibleTrigger asChild>
          <CardHeader className="pb-3 cursor-pointer hover:bg-muted/20 transition-colors rounded-t-lg">
            <CardTitle className="text-base flex items-center justify-between">
              <div className="flex items-center gap-3">
                <meta.Icon className="w-5 h-5 text-muted-foreground" />
                <span className="font-semibold">Rubric Compliance</span>
                <Badge variant="outline" className={`text-xs ${meta.badgeClass}`}>
                  <span className="mr-1">{meta.dot}</span>
                  {meta.label}
                </Badge>
              </div>
              <ChevronDown
                className={`w-5 h-5 text-muted-foreground transition-transform ${
                  open ? "rotate-180" : ""
                }`}
              />
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="space-y-4 pt-0">
            <p className="text-xs text-muted-foreground border-l-2 border-primary/30 pl-3">
              {compliance.status === "custom" &&
                "The AI graded against your rubric exactly. No substitutions were made."}
              {compliance.status === "mixed" &&
                "The AI supplemented or modified your rubric while grading. Review the criteria below to confirm."}
              {compliance.status === "default" &&
                "No custom rubric was detected, so Bottor's default fallback rubric was used. Upload or paste a rubric to grade against your own criteria."}
            </p>

            {/* Criteria used table */}
            <div>
              <h4 className="text-sm font-semibold mb-2">Criteria Used</h4>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-9">Criterion</TableHead>
                    <TableHead className="h-9 w-48">Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {compliance.criteria_used.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={2}
                        className="text-xs text-muted-foreground py-3"
                      >
                        No criteria reported.
                      </TableCell>
                    </TableRow>
                  )}
                  {compliance.criteria_used.map((c, i) => (
                    <TableRow key={`${c.name}-${i}`}>
                      <TableCell className="py-2 text-sm">{c.name}</TableCell>
                      <TableCell className="py-2">
                        <Badge
                          variant="outline"
                          className={`text-xs ${
                            c.source === "teacher"
                              ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-300"
                              : "bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 border-amber-300"
                          }`}
                        >
                          {c.source === "teacher" ? "Teacher rubric" : "Default fallback"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Expected vs Actual (only when teacher rubric exists) */}
            {showComparison && (
              <div>
                <h4 className="text-sm font-semibold mb-2">Expected vs. Actual</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-md border bg-muted/20 p-3">
                    <p className="text-xs font-medium text-muted-foreground mb-2">
                      You specified
                    </p>
                    <ul className="space-y-1">
                      {expected.map((c, i) => {
                        const missing = !actualNorm.includes(norm(c));
                        return (
                          <li
                            key={`exp-${i}`}
                            className={`text-sm ${
                              missing
                                ? "text-red-600 dark:text-red-400 font-medium"
                                : "text-foreground"
                            }`}
                          >
                            • {c}
                            {missing && (
                              <span className="ml-2 text-xs">(skipped)</span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                  <div className="rounded-md border bg-muted/20 p-3">
                    <p className="text-xs font-medium text-muted-foreground mb-2">
                      AI graded against
                    </p>
                    <ul className="space-y-1">
                      {actual.length === 0 && (
                        <li className="text-xs text-muted-foreground">
                          No criteria reported by AI.
                        </li>
                      )}
                      {actual.map((c, i) => {
                        const extra = !expectedNorm.includes(norm(c));
                        return (
                          <li
                            key={`act-${i}`}
                            className={`text-sm ${
                              extra
                                ? "text-red-600 dark:text-red-400 font-medium"
                                : "text-foreground"
                            }`}
                          >
                            • {c}
                            {extra && (
                              <span className="ml-2 text-xs">(added)</span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
