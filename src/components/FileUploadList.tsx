/* src/components/FileUploadList.tsx
 * Displays uploaded files with status chips
 */

import React from "react";
import type { UploadedFileItem } from "@/hooks/useFileUpload";

type Props = {
  files: UploadedFileItem[];
  onRemove?: (fileId: string) => void;
  onRetry?: (fileId: string) => void;
};

function formatBytes(bytes: number) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

function statusLabel(status: UploadedFileItem["status"]) {
  switch (status) {
    case "queued":
      return "Queued";
    case "uploading":
      return "Uploading";
    case "uploaded":
      return "Uploaded";
    case "extracting":
      return "Extracting";
    case "ready":
      return "Ready";
    case "failed":
      return "Failed";
    default:
      return status;
  }
}

export default function FileUploadList({ files, onRemove, onRetry }: Props) {
  if (!files?.length) return null;

  return (
    <div className="space-y-2">
      {files.map((f) => {
        const name = f.fileName || f.file?.name || "Untitled";
        const size = typeof f.size === "number" ? f.size : (f.file?.size ?? 0);

        return (
          <div key={f.id} className="flex items-center justify-between rounded-lg border bg-white/40 px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{name}</div>
              <div className="text-xs opacity-70">
                {formatBytes(size)} <span className="mx-1">•</span>{" "}
                <span
                  className={
                    f.status === "failed"
                      ? "text-red-600"
                      : f.status === "ready"
                        ? "text-emerald-700"
                        : "text-slate-600"
                  }
                >
                  {statusLabel(f.status)}
                </span>
                {f.status === "failed" && f.error ? (
                  <>
                    <span className="mx-1">•</span>
                    <span className="text-red-600 truncate">{f.error}</span>
                  </>
                ) : null}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {f.status === "failed" && onRetry ? (
                <button className="rounded-md border px-2 py-1 text-xs hover:bg-slate-50" onClick={() => onRetry(f.id)}>
                  Retry
                </button>
              ) : null}

              {onRemove ? (
                <button
                  className="rounded-md border px-2 py-1 text-xs hover:bg-slate-50"
                  onClick={() => onRemove(f.id)}
                >
                  ✕
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
