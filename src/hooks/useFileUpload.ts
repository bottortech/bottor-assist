// src/hooks/useFileUpload.ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export type FileStatus = "queued" | "uploading" | "uploaded" | "extracting" | "ready" | "failed";

export type UploadedFileItem = {
  id: string;
  file: File;
  fileName: string;
  fileType: string;
  size: number;
  status: FileStatus;
  extractedText?: string;
  error?: string;
  extractionStartedAt?: number;
};

export type UseFileUploadOptions = {
  maxConcurrentExtractions?: number; // default 2
  extractionTimeoutMs?: number; // default 30000
};

function isProcessingStatus(status: FileStatus) {
  return ["queued", "uploading", "uploaded", "extracting"].includes(status);
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = () => {
      const result = reader.result as string;
      // result is data:<mime>;base64,<data>
      const base64 = result.split(",")[1] ?? "";
      resolve(base64);
    };
    reader.readAsDataURL(file);
  });
}

export function useFileUpload(options: UseFileUploadOptions = {}) {
  const { toast } = useToast();

  const DEFAULT_OPTIONS = useMemo(
    () => ({
      maxConcurrentExtractions: 2,
      extractionTimeoutMs: 30000,
    }),
    [],
  );

  const { maxConcurrentExtractions, extractionTimeoutMs } = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  const [files, setFiles] = useState<UploadedFileItem[]>([]);
  const [combinedText, setCombinedText] = useState<string>("");
  const [isExtracting, setIsExtracting] = useState<boolean>(false);

  // Always-current state ref (prevents stale-closure bugs)
  const filesRef = useRef<UploadedFileItem[]>([]);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  // Concurrency control
  const activeExtractions = useRef<number>(0);
  const extractionQueue = useRef<string[]>([]);
  const pumpingQueue = useRef<boolean>(false);

  const updateFileStatus = useCallback((fileId: string, patch: Partial<UploadedFileItem>) => {
    setFiles((prev) => prev.map((f) => (f.id === fileId ? { ...f, ...patch } : f)));
  }, []);

  const getFileId = useCallback((file: File): string => {
    // Stable-ish unique id for this session
    return `${file.name}_${file.lastModified}_${Math.random().toString(36).slice(2, 9)}`;
  }, []);

  // Calls your Supabase edge function to extract text
  const extractTextFromFile = useCallback(
    async (file: File): Promise<{ success: true; text: string } | { success: false; error: string }> => {
      try {
        const base64 = await fileToBase64(file);

        const { data, error } = await supabase.functions.invoke("extract-text", {
          body: {
            file_data: base64,
            file_type: file.type,
            file_name: file.name,
          },
        });

        if (error) {
          return { success: false, error: error.message || "Extraction failed" };
        }

        const text = (data as any)?.text ?? "";
        return { success: true, text: typeof text === "string" ? text : "" };
      } catch (err: any) {
        return { success: false, error: err?.message || "Extraction failed" };
      }
    },
    [],
  );

  const processExtraction = useCallback(
    async (fileId: string): Promise<void> => {
      const fileItem = filesRef.current.find((f) => f.id === fileId);
      if (!fileItem) return;

      // Only run extraction when uploaded/queued states
      if (fileItem.status !== "uploaded" && fileItem.status !== "queued") return;

      updateFileStatus(fileId, {
        status: "extracting",
        extractionStartedAt: Date.now(),
        error: undefined,
      });

      const result = await Promise.race([
        extractTextFromFile(fileItem.file),
        new Promise<{ success: false; error: string }>((resolve) =>
          setTimeout(() => resolve({ success: false, error: "Extraction timeout" }), extractionTimeoutMs),
        ),
      ]);

      if (!result.success) {
        updateFileStatus(fileId, { status: "failed", error: result.error || "Extraction failed" });
        return;
      }

      updateFileStatus(fileId, { status: "ready", extractedText: result.text, error: undefined });
    },
    [extractTextFromFile, extractionTimeoutMs, updateFileStatus],
  );

  const pumpQueue = useCallback(async () => {
    if (pumpingQueue.current) return;
    pumpingQueue.current = true;

    try {
      while (activeExtractions.current < maxConcurrentExtractions && extractionQueue.current.length > 0) {
        const nextId = extractionQueue.current.shift()!;
        activeExtractions.current += 1;
        setIsExtracting(true);

        // Fire and await so we can decrement properly
        await processExtraction(nextId);

        activeExtractions.current -= 1;

        // Update combined text progressively
        const snapshot = filesRef.current;
        const combined = snapshot
          .filter((f) => f.status === "ready" && (f.extractedText?.trim()?.length ?? 0) > 0)
          .map((f) => `--- ${f.fileName} ---\n${f.extractedText}\n`)
          .join("\n");
        setCombinedText(combined);

        // Loop continues for remaining queue items
      }
    } finally {
      pumpingQueue.current = false;

      const stillProcessing =
        extractionQueue.current.length > 0 || filesRef.current.some((f) => f.status === "extracting");
      setIsExtracting(stillProcessing);
    }
  }, [maxConcurrentExtractions, processExtraction]);

  const enqueueForExtraction = useCallback(
    (fileId: string) => {
      // prevent duplicates
      if (!extractionQueue.current.includes(fileId)) {
        extractionQueue.current.push(fileId);
      }
      void pumpQueue();
    },
    [pumpQueue],
  );

  const addFiles = useCallback(
    async (incomingFiles: File[]) => {
      if (!incomingFiles?.length) return;

      const newItems: UploadedFileItem[] = incomingFiles.map((file) => {
        const id = getFileId(file);
        return {
          id,
          file,
          fileName: file.name,
          fileType: file.type,
          size: file.size,
          status: "uploaded", // we treat client upload as instant; extraction is the real work
        };
      });

      setFiles((prev) => [...prev, ...newItems]);

      // Enqueue extractions
      newItems.forEach((item) => enqueueForExtraction(item.id));
    },
    [enqueueForExtraction, getFileId],
  );

  const removeFile = useCallback((fileId: string) => {
    // Remove from queue too
    extractionQueue.current = extractionQueue.current.filter((id) => id !== fileId);
    setFiles((prev) => prev.filter((f) => f.id !== fileId));
  }, []);

  const clearAll = useCallback(() => {
    extractionQueue.current = [];
    activeExtractions.current = 0;
    pumpingQueue.current = false;
    setFiles([]);
    setCombinedText("");
    setIsExtracting(false);
  }, []);

  const retryExtraction = useCallback(
    (fileId: string) => {
      updateFileStatus(fileId, { status: "uploaded", error: undefined, extractedText: undefined });
      enqueueForExtraction(fileId);
      toast({
        title: "Retrying extraction",
        description: "Trying again…",
      });
    },
    [enqueueForExtraction, toast, updateFileStatus],
  );

  const retryAllFailed = useCallback(() => {
    const failed = filesRef.current.filter((f) => f.status === "failed").map((f) => f.id);
    failed.forEach((id) => retryExtraction(id));
  }, [retryExtraction]);

  // Watchdog: if anything is "extracting" > timeout+5s, mark failed
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const snapshot = filesRef.current;

      snapshot.forEach((f) => {
        if (f.status === "extracting" && f.extractionStartedAt) {
          if (now - f.extractionStartedAt > extractionTimeoutMs + 5000) {
            updateFileStatus(f.id, { status: "failed", error: "Extraction timeout" });
          }
        }
      });

      // Also keep combined text updated
      const combined = snapshot
        .filter((f) => f.status === "ready" && (f.extractedText?.trim()?.length ?? 0) > 0)
        .map((f) => `--- ${f.fileName} ---\n${f.extractedText}\n`)
        .join("\n");
      setCombinedText(combined);

      const stillProcessing = extractionQueue.current.length > 0 || snapshot.some((f) => isProcessingStatus(f.status));
      setIsExtracting(stillProcessing);
    }, 1000);

    return () => clearInterval(interval);
  }, [extractionTimeoutMs, updateFileStatus]);

  return {
    files,
    combinedText,
    isExtracting,

    addFiles,
    removeFile,
    clearAll,

    retryExtraction,
    retryAllFailed,
  };
}
