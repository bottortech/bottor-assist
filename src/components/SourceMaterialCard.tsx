import { CheckCircle2, FileText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export interface SourceMaterialMeta {
  sourceMaterialUsed: boolean;
  sourceMaterialCharacterCount: number;
  sourceMaterialFileNames: string[];
}

interface SourceMaterialCardProps {
  meta: SourceMaterialMeta | null | undefined;
}

/**
 * Small confirmation card shown in the grading result area when the AI
 * grader was given assignment source material. Renders nothing if no
 * source material was used, so callers can include it unconditionally.
 */
export function SourceMaterialCard({ meta }: SourceMaterialCardProps) {
  if (!meta?.sourceMaterialUsed) return null;

  const files = meta.sourceMaterialFileNames ?? [];
  const filesLabel =
    files.length > 0
      ? files.join(", ")
      : meta.sourceMaterialCharacterCount > 0
        ? `Pasted text (${meta.sourceMaterialCharacterCount.toLocaleString()} characters)`
        : "Provided";

  return (
    <Card className="border-emerald-200 bg-emerald-50/60">
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center gap-2 text-emerald-800 font-medium text-sm">
          <CheckCircle2 className="w-4 h-4" />
          Source material used: Yes
        </div>
        <div className="flex items-start gap-2 text-sm text-emerald-900/80">
          <FileText className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <span className="font-medium">Files checked: </span>
            <span>{filesLabel}</span>
          </div>
        </div>
        <div className="text-xs text-emerald-900/70 pl-6">
          Purpose: Quote verification and source understanding
        </div>
      </CardContent>
    </Card>
  );
}
