/**
 * Optimistic File Upload Hook (v2 - Resilient Non-Blocking Pipeline)
 *
 * Fixes “Processing… 0%” hangs by:
 * - Concurrency limiting (default 2 at a time)
 * - Hard timeout on extraction (default 15s)
 * - Watchdog that auto-fails stuck extractions
 * - Never leaving files in an “in-progress” state forever
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
  status: FileStatus;
  extractedText?: string;
  error?: string;
  extractionStartedAt?: number;
};

export type UseFileUploadOptions = {
  maxConcurrentExtractions?: number; // default 2
  maxDimension?: number; // default 1600 (image downscale)
  jpegQuality?: number; // default 0.75
  extractionTimeoutMs?: number; // default 15000
};

const DEFAULT_OPTIONS: Required<UseFileUploadOptions> = {
  maxConcurrentExtractions: 2,
  maxDimension: 1600,
  jpegQuality: 0.75,
  extractionTimeoutMs: 15000,
};

const isProcessingStatus = (status: FileStatus) => ["queued", "uploading", "uploaded", "extracting"].includes(status);

const safeId = () => `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

function withTimeout<T>(promise: Promise<T>, ms: number, label = "timeout"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(label)), ms);
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

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("FileReader failed"));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") return reject(new Error("Bad FileReader result"));
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

async function downscaleImageIfNeeded(file: File, maxDimension: number, jpegQuality: number): Promise<File> {
  // Only for images. PDFs pass through.
  if (!file.type.startsWith("image/")) return file;

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Image read failed"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Image decode failed"));
    i.src = dataUrl;
  });

  const { width, height } = img;
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  if (scale >= 1) return file;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);

  const ctx = canvas.getContext("2d");
  if (!ctx) return file;

  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const blob: Blob = await new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b ?? new Blob()), "image/jpeg", jpegQuality);
  });

  return new File([blob], file.name.replace(/\.(png|jpg|jpeg|webp)$/i, ".jpg"), {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}

async function convertHeicIfNeeded(file: File): Promise<File> {
  const isHeic =
    file.type === "image/heic" ||
    file.type === "image/heif" ||
    /\.heic$/i.test(file.name) ||
    /\.heif$/i.test(file.name);

  if (!isHeic) return file;

  const converted = (await heic2any({
    blob: file,
    toType: "image/jpeg",
    quality: 0.85,
  })) as Blob;

  return new File([converted], file.name.replace(/\.(heic|heif)$/i, ".jpg"), {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}

export function useFileUpload(options: UseFileUploadOptions = {}) {
  const { toast } = useToast();
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const [files, setFiles] = useState<UploadedFileItem[]>([]);
  const [combinedText, setCombinedText] = useState<string>("");

  // Concurrency control
  const activeExtractions = useRef(0);
  const queueTick = useRef(0);

  const updateFile = useCallback((id: string, patch: Partial<UploadedFileItem>) => {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }, []);

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setFiles([]);
    setCombinedText("");
  }, []);

  const addFiles = useCallback((incoming: File[]) => {
    const items: UploadedFileItem[] = incoming.map((file) => ({
      id: safeId(),
      file,
      fileName: file.name,
      size: file.size,
      status: "queued",
    }));
    setFiles((prev) => [...prev, ...items]);
    queueTick.current++;
  }, []);

  const extractTextFromFile = useCallback(
    async (file: File): Promise<{ success: true; text: string } | { success: false; error: string }> => {
      try {
        // Normalize images (HEIC -> JPG, downscale)
        let normalized = await convertHeicIfNeeded(file);
        normalized = await downscaleImageIfNeeded(normalized, opts.maxDimension, opts.jpegQuality);

        const base64 = await fileToBase64(normalized);

        // IMPORTANT: Your Edge Function must accept:
        // { file_data: base64, file_type: normalized.type, file_name: normalized.name }
        const res = await withTimeout(
          supabase.functions.invoke("extract-text", {
            body: {
              file_data: base64,
              file_type: normalized.type,
              file_name: normalized.name,
            },
          }),
          opts.extractionTimeoutMs,
          "Extraction timed out",
        );

        const err = (res as any)?.error;
        if (err) return { success: false, error: err.message ?? "Extraction failed" };

        const text = (res as any)?.data?.text;
        if (typeof text !== "string") return { success: false, error: "No text returned" };

        return { success: true, text };
      } catch (e: any) {
        return { success: false, error: e?.message ?? "Extraction error" };
      }
    },
    [opts.extractionTimeoutMs, opts.jpegQuality, opts.maxDimension],
  );

  const processOne = useCallback(
    async (item: UploadedFileItem) => {
      // If user removed it, skip.
      // Also, only process if queued/uploaded/uploading
      if (!isProcessingStatus(item.status)) return;

      activeExtractions.current += 1;

      try {
        updateFile(item.id, { status: "uploading", error: undefined });

        // For this app, “uploading” is just local prep → then “uploaded”
        updateFile(item.id, { status: "uploaded" });

        // Start extraction
        updateFile(item.id, { status: "extracting", extractionStartedAt: Date.now() });

        const result = await extractTextFromFile(item.file);

        if (result.success) {
          updateFile(item.id, { status: "ready", extractedText: result.text, error: undefined });
        } else {
          updateFile(item.id, { status: "failed", error: result.error });
        }
      } catch (e: any) {
        updateFile(item.id, { status: "failed", error: e?.message ?? "Unknown error" });
      } finally {
        activeExtractions.current = Math.max(0, activeExtractions.current - 1);
        queueTick.current++;
      }
    },
    [extractTextFromFile, updateFile],
  );

  // Watchdog: if an item sits in extracting too long, fail it so UI never hangs
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setFiles((prev) =>
        prev.map((f) => {
          if (
            f.status === "extracting" &&
            f.extractionStartedAt &&
            now - f.extractionStartedAt > opts.extractionTimeoutMs + 3000
          ) {
            return { ...f, status: "failed", error: "Extraction stuck — auto-failed" };
          }
          return f;
        }),
      );
    }, 1000);

    return () => clearInterval(interval);
  }, [opts.extractionTimeoutMs]);

  // Queue runner (non-blocking, concurrency-limited)
  useEffect(() => {
    const runnable = files.filter((f) => f.status === "queued" || f.status === "uploaded");
    if (runnable.length === 0) return;

    if (activeExtractions.current >= opts.maxConcurrentExtractions) return;

    const slots = opts.maxConcurrentExtractions - activeExtractions.current;
    const nextBatch = runnable.slice(0, Math.max(0, slots));

    nextBatch.forEach((item) => {
      // fire-and-forget; state updates handle UI
      void processOne(item);
    });
  }, [files, opts.maxConcurrentExtractions, processOne]);

  // Keep combinedText updated as files complete
  useEffect(() => {
    const readyTexts = files
      .filter((f) => f.status === "ready" && typeof f.extractedText === "string")
      .map((f) => f.extractedText ?? "");

    setCombinedText(readyTexts.join("\n\n---\n\n"));
  }, [files]);

  const isProcessing = useMemo(() => files.some((f) => isProcessingStatus(f.status)), [files]);

  const retryFailed = useCallback(() => {
    const failed = files.filter((f) => f.status === "failed");
    if (failed.length === 0) {
      toast({ title: "No failed files", description: "Nothing to retry." });
      return;
    }
    failed.forEach((f) => updateFile(f.id, { status: "queued", error: undefined, extractedText: undefined }));
    queueTick.current++;
    toast({ title: "Retry started", description: `Retrying ${failed.length} file(s).` });
  }, [files, toast, updateFile]);

  return {
    files,
    addFiles,
    removeFile,
    clearAll,
    retryFailed,
    isProcessing,
    combinedText,
  };
}
