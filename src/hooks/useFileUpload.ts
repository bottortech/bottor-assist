import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import heic2any from "heic2any";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export type FileStatus = "queued" | "uploading" | "uploaded" | "extracting" | "ready" | "failed";

export type UploadedFileItem = {
  id: string;
  file: File;
  fileName: string;
  fileType: string;
  status: FileStatus;
  extractedText?: string;
  error?: string;
  extractionStartedAt?: number;
};

type UseFileUploadOptions = {
  maxConcurrentExtractions?: number; // keep low for stability
  extractionTimeoutMs?: number; // watchdog timeout
  jpegQuality?: number;
  maxDimension?: number;
};

const DEFAULT_OPTIONS: Required<UseFileUploadOptions> = {
  maxConcurrentExtractions: 2,
  extractionTimeoutMs: 15000, // 15s pilot-safe
  jpegQuality: 0.8,
  maxDimension: 1600,
};

function getSafeFileType(file: File) {
  return file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream");
}

function makeId(file: File) {
  return `${file.name}_${file.size}_${file.lastModified}_${Math.random().toString(36).slice(2)}`;
}

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// Convert HEIC -> JPEG (so extraction doesn’t hang)
async function normalizeFileIfNeeded(file: File): Promise<File> {
  const nameLower = file.name.toLowerCase();
  const isHeic =
    file.type === "image/heic" ||
    file.type === "image/heif" ||
    nameLower.endsWith(".heic") ||
    nameLower.endsWith(".heif");

  if (!isHeic) return file;

  const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
  const blob = Array.isArray(converted) ? converted[0] : converted;

  return new File([blob], file.name.replace(/\.(heic|heif)$/i, ".jpg"), { type: "image/jpeg" });
}

export function useFileUpload(options: UseFileUploadOptions = {}) {
  const { toast } = useToast();

  const opts = useMemo(() => ({ ...DEFAULT_OPTIONS, ...options }), [options]);

  const [files, setFiles] = useState<UploadedFileItem[]>([]);
  const [combinedText, setCombinedText] = useState<string>("");

  // Concurrency control (avoid “stuck processing…”)
  const activeExtractions = useRef(0);
  const extractionQueue = useRef<string[]>([]);
  const ticking = useRef(false);

  const totalFiles = files.length;
  const completedFiles = files.filter((f) => f.status === "ready").length;
  const failedFiles = files.filter((f) => f.status === "failed").length;

  const isExtracting = useMemo(() => {
    return files.some(
      (f) => f.status === "queued" || f.status === "uploading" || f.status === "uploaded" || f.status === "extracting",
    );
  }, [files]);

  const progress = useMemo(() => {
    if (totalFiles === 0) return 0;
    // “uploaded” counts as partial progress
    const doneish = files.filter((f) => f.status === "ready").length;
    const mid = files.filter((f) => f.status === "uploaded" || f.status === "extracting").length;
    return Math.min(100, Math.round(((doneish + mid * 0.5) / totalFiles) * 100));
  }, [files, totalFiles]);

  const updateFile = useCallback((id: string, patch: Partial<UploadedFileItem>) => {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }, []);

  const invokeExtract = useCallback(
    async (item: UploadedFileItem): Promise<{ ok: true; text: string } | { ok: false; error: string }> => {
      const start = Date.now();

      updateFile(item.id, { status: "extracting", extractionStartedAt: start, error: undefined });

      try {
        // watchdog timeout to prevent infinite spinner
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Extraction timed out")), opts.extractionTimeoutMs),
        );

        const extractPromise = (async () => {
          const base64 = await fileToBase64(item.file);
          const { data, error } = await supabase.functions.invoke("extract-text", {
            body: {
              file_data: base64,
              file_type: item.fileType,
              file_name: item.fileName,
            },
          });

          if (error) throw error;
          const text = (data?.text as string) || "";
          return text;
        })();

        const text = await Promise.race([extractPromise, timeoutPromise]);

        updateFile(item.id, { status: "ready", extractedText: text, error: undefined });
        return { ok: true, text };
      } catch (e: any) {
        const msg = e?.message || "Unknown extraction error";
        updateFile(item.id, { status: "failed", error: msg });
        return { ok: false, error: msg };
      }
    },
    [opts.extractionTimeoutMs, updateFile],
  );

  const pumpQueue = useCallback(async () => {
    if (ticking.current) return;
    ticking.current = true;

    try {
      while (extractionQueue.current.length > 0 && activeExtractions.current < opts.maxConcurrentExtractions) {
        const nextId = extractionQueue.current.shift();
        if (!nextId) break;

        const item = files.find((f) => f.id === nextId);
        if (!item) continue;

        // Only process if it’s in a valid state
        if (!["uploaded", "queued", "failed"].includes(item.status)) continue;

        activeExtractions.current += 1;

        // Run extraction “in background”
        (async () => {
          const res = await invokeExtract(item);

          // stream combinedText as each file finishes
          if (res.ok) {
            setCombinedText((prev) => (prev ? `${prev}\n\n${res.text}` : res.text));
          }

          activeExtractions.current -= 1;
          // keep pumping
          pumpQueue();
        })();
      }
    } finally {
      ticking.current = false;
    }
  }, [files, invokeExtract, opts.maxConcurrentExtractions]);

  const enqueueExtraction = useCallback(
    (id: string) => {
      if (!extractionQueue.current.includes(id)) extractionQueue.current.push(id);
      pumpQueue();
    },
    [pumpQueue],
  );

  const addFiles = useCallback(
    async (incoming: File[]) => {
      // normalize HEIC before we create items
      const normalized: File[] = [];
      for (const f of incoming) {
        try {
          normalized.push(await normalizeFileIfNeeded(f));
        } catch {
          normalized.push(f);
        }
      }

      const items: UploadedFileItem[] = normalized.map((file) => {
        const id = makeId(file);
        return {
          id,
          file,
          fileName: file.name,
          fileType: getSafeFileType(file),
          status: "uploaded", // we already have the file in-browser; “uploaded” means ready to extract
        };
      });

      setFiles((prev) => [...prev, ...items]);

      // Immediately queue extraction
      setTimeout(() => {
        items.forEach((it) => enqueueExtraction(it.id));
      }, 0);
    },
    [enqueueExtraction],
  );

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    extractionQueue.current = extractionQueue.current.filter((x) => x !== id);
  }, []);

  const clearAll = useCallback(() => {
    setFiles([]);
    setCombinedText("");
    extractionQueue.current = [];
    activeExtractions.current = 0;
  }, []);

  const retryExtraction = useCallback(
    (id: string) => {
      const item = files.find((f) => f.id === id);
      if (!item) return;
      updateFile(id, { status: "uploaded", error: undefined, extractedText: undefined });
      enqueueExtraction(id);
    },
    [enqueueExtraction, files, updateFile],
  );

  const retryAllFailed = useCallback(() => {
    const failed = files.filter((f) => f.status === "failed").map((f) => f.id);
    if (failed.length === 0) {
      toast({ title: "No failed files to retry." });
      return;
    }
    failed.forEach((id) => retryExtraction(id));
  }, [files, retryExtraction, toast]);

  // Safety: if a file sits in "extracting" too long, flip to failed (prevents infinite spinner)
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setFiles((prev) =>
        prev.map((f) => {
          if (f.status !== "extracting") return f;
          const started = f.extractionStartedAt || now;
          if (now - started > opts.extractionTimeoutMs + 2000) {
            return { ...f, status: "failed", error: "Extraction timed out" };
          }
          return f;
        }),
      );
    }, 1000);

    return () => clearInterval(interval);
  }, [opts.extractionTimeoutMs]);

  return {
    files,
    setFiles,

    // required by GradePapers.tsx per your screenshot
    totalFiles,
    completedFiles,
    failedFiles,
    progress,
    isExtracting,
    retryExtraction,
    retryAllFailed,

    // existing helpers
    combinedText,
    addFiles,
    removeFile,
    clearAll,
  };
}
