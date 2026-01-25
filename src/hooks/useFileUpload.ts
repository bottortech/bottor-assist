/* src/hooks/useFileUpload.ts
 * Resilient file upload + extraction hook for Bottor Assist
 * - Immediate UI updates (Queued/Uploading/Extracting/Ready/Failed)
 * - Concurrency-limited extraction
 * - Timeout guard so we never hang forever
 * - Retry support per-file
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import heic2any from "heic2any";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export type FileStatus = "queued" | "uploading" | "uploaded" | "extracting" | "ready" | "failed";

export type UploadedFileItem = {
  id: string;
  file: File;
  fileName: string;
  size: number;
  mimeType: string;

  status: FileStatus;
  extractedText?: string;
  error?: string;

  // Optional: timestamps to help watchdog/UX
  createdAt: number;
  uploadFinishedAt?: number;
  extractionStartedAt?: number;
  extractionFinishedAt?: number;
};

export type UseFileUploadOptions = {
  maxConcurrentExtractions?: number; // default 2
  extractionTimeoutMs?: number; // default 20000
  maxImageDimension?: number; // (not used here but kept for future)
  jpegQuality?: number; // (not used here but kept for future)
};

function safeErrMessage(err: unknown) {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return "Unknown error";
  }
}

function parseNameId(fileName: string) {
  // Supports: Lesson4_Functions__AaliyahJohnson__p1.pdf
  // You can tweak this later if needed.
  const base = fileName.replace(/\.[^/.]+$/, "");
  const parts = base.split("__").filter(Boolean);
  // If your filenames are like Lesson4_Functions__Name__p1
  const student = parts.length >= 2 ? parts[1] : undefined;
  const assignment = parts.length >= 1 ? parts[0] : undefined;
  const page = parts.find((p) => /^p\d+$/i.test(p));
  return { student, assignment, page };
}

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function normalizeToSupportedFile(file: File): Promise<File> {
  // Convert HEIC -> JPEG
  if (file.type === "image/heic" || file.name.toLowerCase().endsWith(".heic")) {
    const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.85 });
    const blob = Array.isArray(converted) ? converted[0] : converted;
    const newName = file.name.replace(/\.heic$/i, ".jpg");
    return new File([blob as BlobPart], newName, { type: "image/jpeg" });
  }
  return file;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string) {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    promise
      .then((v) => {
        clearTimeout(t);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(t);
        reject(e);
      });
  });
}

export function useFileUpload(options: UseFileUploadOptions = {}) {
  const { toast } = useToast();

  const { maxConcurrentExtractions = 2, extractionTimeoutMs = 20000 } = options;

  const [files, setFiles] = useState<UploadedFileItem[]>([]);

  // Track in-flight extraction count
  const activeExtractions = useRef(0);
  // Simple FIFO queue of file IDs waiting for extraction
  const extractionQueue = useRef<string[]>([]);
  // Prevent double-enqueue
  const queuedSet = useRef<Set<string>>(new Set());

  const updateFile = useCallback((fileId: string, patch: Partial<UploadedFileItem>) => {
    setFiles((prev) => prev.map((f) => (f.id === fileId ? { ...f, ...patch } : f)));
  }, []);

  const removeFile = useCallback((fileId: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== fileId));
    queuedSet.current.delete(fileId);
    extractionQueue.current = extractionQueue.current.filter((id) => id !== fileId);
  }, []);

  const clearAll = useCallback(() => {
    setFiles([]);
    queuedSet.current.clear();
    extractionQueue.current = [];
    activeExtractions.current = 0;
  }, []);

  const getFileId = useCallback((file: File) => {
    // Stable-ish ID across quick re-uploads:
    return `${file.name}_${file.size}_${file.lastModified}_${Math.random().toString(36).slice(2, 9)}`;
  }, []);

  const extractTextFromFile = useCallback(
    async (
      fileItem: UploadedFileItem,
    ): Promise<{ success: true; text: string } | { success: false; error: string }> => {
      try {
        const base64 = await fileToBase64(fileItem.file);

        const invokePromise = supabase.functions.invoke("extract-text", {
          body: {
            file_data: base64,
            file_type: fileItem.mimeType || fileItem.file.type,
            file_name: fileItem.fileName,
          },
        });

        const result = await withTimeout(
          invokePromise,
          extractionTimeoutMs,
          `Extraction timed out after ${Math.round(extractionTimeoutMs / 1000)}s`,
        );

        if (result.error) {
          return { success: false, error: safeErrMessage(result.error) };
        }

        const text = (result.data as any)?.text ?? "";
        return { success: true, text: typeof text === "string" ? text : "" };
      } catch (err) {
        return { success: false, error: safeErrMessage(err) };
      }
    },
    [extractionTimeoutMs],
  );

  const runNextExtraction = useCallback(async () => {
    if (activeExtractions.current >= maxConcurrentExtractions) return;

    const nextId = extractionQueue.current.shift();
    if (!nextId) return;

    queuedSet.current.delete(nextId);

    const fileItem = files.find((f) => f.id === nextId);
    if (!fileItem) return;

    // Only extract if uploaded or queued; if already ready/failed, skip
    if (!["uploaded", "queued"].includes(fileItem.status)) return;

    activeExtractions.current += 1;

    updateFile(nextId, {
      status: "extracting",
      extractionStartedAt: Date.now(),
      error: undefined,
    });

    const result = await extractTextFromFile(fileItem);

    if (result.success === true) {
      updateFile(nextId, {
        status: "ready",
        extractedText: result.text,
        extractionFinishedAt: Date.now(),
        error: undefined,
      });
    } else {
      updateFile(nextId, {
        status: "failed",
        extractionFinishedAt: Date.now(),
        error: result.error,
      });
    }

    activeExtractions.current -= 1;

    // Continue draining queue
    void runNextExtraction();
  }, [extractTextFromFile, files, maxConcurrentExtractions, updateFile]);

  const enqueueExtraction = useCallback(
    (fileId: string) => {
      if (queuedSet.current.has(fileId)) return;
      queuedSet.current.add(fileId);
      extractionQueue.current.push(fileId);
      void runNextExtraction();
    },
    [runNextExtraction],
  );

  const addFiles = useCallback(
    async (incoming: FileList | File[]) => {
      const list = Array.isArray(incoming) ? incoming : Array.from(incoming);

      for (const rawFile of list) {
        try {
          const file = await normalizeToSupportedFile(rawFile);
          const id = getFileId(file);

          const item: UploadedFileItem = {
            id,
            file,
            fileName: file.name,
            size: file.size,
            mimeType: file.type || "application/octet-stream",
            status: "uploaded", // we treat local selection as "uploaded" for pilot (no separate storage step)
            createdAt: Date.now(),
            uploadFinishedAt: Date.now(),
          };

          setFiles((prev) => [item, ...prev]);

          // Immediately queue extraction (non-blocking)
          enqueueExtraction(id);
        } catch (err) {
          toast({
            title: "File failed to add",
            description: safeErrMessage(err),
            variant: "destructive",
          });
        }
      }
    },
    [enqueueExtraction, getFileId, toast],
  );

  const retryExtraction = useCallback(
    (fileId: string) => {
      const f = files.find((x) => x.id === fileId);
      if (!f) return;
      updateFile(fileId, { status: "uploaded", error: undefined });
      enqueueExtraction(fileId);
    },
    [enqueueExtraction, files, updateFile],
  );

  // Watchdog: auto-fail files stuck in extracting too long (prevents infinite spinner)
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setFiles((prev) =>
        prev.map((f) => {
          if (f.status !== "extracting") return f;
          const started = f.extractionStartedAt ?? f.createdAt;
          if (now - started > extractionTimeoutMs + 2000) {
            return {
              ...f,
              status: "failed",
              error: f.error ?? "Extraction stuck — auto-failed. Please retry.",
              extractionFinishedAt: now,
            };
          }
          return f;
        }),
      );
    }, 1000);

    return () => clearInterval(interval);
  }, [extractionTimeoutMs]);

  // Derived stats (these are what your UI wants)
  const totalFiles = files.length;
  const completedFiles = useMemo(() => files.filter((f) => f.status === "ready").length, [files]);
  const failedFiles = useMemo(() => files.filter((f) => f.status === "failed").length, [files]);

  const isProcessing = useMemo(
    () =>
      files.some(
        (f) =>
          f.status === "queued" || f.status === "uploading" || f.status === "uploaded" || f.status === "extracting",
      ),
    [files],
  );

  const isExtracting = useMemo(() => files.some((f) => f.status === "extracting"), [files]);

  const progress = useMemo(() => {
    if (totalFiles === 0) return 0;
    const done = completedFiles + failedFiles;
    return Math.round((done / totalFiles) * 100);
  }, [completedFiles, failedFiles, totalFiles]);

  // Combined text from all ready files
  const combinedText = useMemo(() => {
    return files
      .filter((f) => f.status === "ready" && f.extractedText)
      .map((f) => f.extractedText!)
      .join("\n\n--- PAGE BREAK ---\n\n");
  }, [files]);

  return {
    // core
    files,
    setFiles,
    addFiles,
    removeFile,
    clearAll,

    // derived
    totalFiles,
    completedFiles,
    failedFiles,
    progress,
    isProcessing,
    isExtracting,
    combinedText,

    // helpers
    retryExtraction,

    // optional parsing helpers (useful for auto-grouping)
    parseNameId,
  };
}
