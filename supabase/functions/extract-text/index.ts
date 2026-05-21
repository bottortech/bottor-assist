/**
 * =============================================================================
 * EXTRACT TEXT EDGE FUNCTION
 * =============================================================================
 *
 * Extract text from uploaded files. Supports:
 *  - application/pdf            → Gemini vision OCR (text + handwritten)
 *  - image/*                    → Gemini vision OCR
 *  - text/plain                 → decoded directly
 *  - application/vnd.openxmlformats-officedocument.wordprocessingml.document (.docx)
 *                               → mammoth raw-text extraction
 *
 * .doc (legacy Word binary) is intentionally NOT supported — it is unreliable
 * to parse server-side. The UI removes it from the accepted list.
 *
 * INPUT:  { file_data: base64, file_type: mime, file_name: string }
 * OUTPUT: { text: string }
 * ERRORS: 400 with `{ error, code }` where code is one of:
 *   - missing_file
 *   - missing_type
 *   - unsupported_type
 *   - image_based_pdf
 *   - docx_parse_failed
 *   - empty_extraction
 *   - rate_limited
 *   - credits_exhausted
 *   - ai_failed
 * =============================================================================
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import mammoth from "npm:mammoth@1.8.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Best-effort MIME from filename when client didn't supply one. */
function mimeFromName(name: string | undefined): string | null {
  if (!name) return null;
  const ext = name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "pdf": return "application/pdf";
    case "txt": return "text/plain";
    case "md": return "text/plain";
    case "docx": return DOCX_MIME;
    case "doc": return "application/msword";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "png": return "image/png";
    case "webp": return "image/webp";
    case "heic": return "image/heic";
    case "heif": return "image/heif";
    default: return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { file_data, file_type, file_name } = await req.json();

    if (!file_data) {
      return jsonResponse(
        { error: "No file data provided.", code: "missing_file" },
        400,
      );
    }

    // Fall back to extension-based MIME if client didn't send one (common for
    // .docx in some browsers, or anything uploaded from an <input> with a
    // missing type).
    const resolvedType =
      (typeof file_type === "string" && file_type.length > 0
        ? file_type
        : mimeFromName(file_name)) ?? "";

    if (!resolvedType) {
      return jsonResponse(
        {
          error:
            "Could not determine file type. Please rename the file with a .pdf, .txt, or .docx extension and try again.",
          code: "missing_type",
        },
        400,
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    console.log(
      `[extract-text] Processing file: ${file_name}, resolved type: ${resolvedType}`,
    );

    let extractedText = "";

    if (resolvedType === "application/pdf") {
      if (!LOVABLE_API_KEY) {
        return jsonResponse(
          {
            error:
              "Text extraction service is temporarily unavailable. Please paste the text directly.",
            code: "ai_failed",
          },
          503,
        );
      }
      extractedText = await extractFromPDF(file_data, LOVABLE_API_KEY);

      // Heuristic: if the model returned essentially nothing, it's a scanned
      // / image-only PDF that we cannot transcribe well.
      const meaningful = extractedText.replace(/\s+/g, "");
      if (meaningful.length < 20) {
        return jsonResponse(
          {
            error:
              "This PDF appears to be image-based (scanned). Please upload a text-based PDF, a .docx, or paste the text directly.",
            code: "image_based_pdf",
          },
          422,
        );
      }
    } else if (resolvedType.startsWith("image/")) {
      if (!LOVABLE_API_KEY) {
        return jsonResponse(
          {
            error:
              "Text extraction service is temporarily unavailable. Please paste the text directly.",
            code: "ai_failed",
          },
          503,
        );
      }
      extractedText = await extractFromImage(
        file_data,
        resolvedType,
        LOVABLE_API_KEY,
      );
    } else if (resolvedType === "text/plain" || resolvedType.startsWith("text/")) {
      try {
        const bytes = base64ToBytes(file_data);
        extractedText = new TextDecoder("utf-8").decode(bytes);
      } catch (err) {
        console.error("[extract-text] text decode failed:", err);
        return jsonResponse(
          {
            error: "Could not read this text file. Please re-save it as UTF-8.",
            code: "empty_extraction",
          },
          422,
        );
      }
    } else if (resolvedType === DOCX_MIME) {
      try {
        const bytes = base64ToBytes(file_data);
        const result = await mammoth.extractRawText({
          buffer: bytes,
        } as unknown as { buffer: Uint8Array });
        extractedText = (result?.value ?? "").trim();
        if (!extractedText) {
          return jsonResponse(
            {
              error:
                "This .docx file appears to be empty. Please paste the text directly.",
              code: "empty_extraction",
            },
            422,
          );
        }
      } catch (err) {
        console.error("[extract-text] docx parse failed:", err);
        return jsonResponse(
          {
            error:
              "Could not read this .docx file. Try saving as PDF or paste the text directly.",
            code: "docx_parse_failed",
          },
          422,
        );
      }
    } else if (resolvedType === "application/msword") {
      return jsonResponse(
        {
          error:
            "Legacy .doc files are not supported. Please save as .docx or .pdf and try again.",
          code: "unsupported_type",
        },
        415,
      );
    } else {
      return jsonResponse(
        {
          error:
            "Unsupported file format. Please upload a .pdf, .txt, or .docx file.",
          code: "unsupported_type",
        },
        415,
      );
    }

    console.log(`[extract-text] Extracted ${extractedText.length} characters`);

    return jsonResponse({ text: extractedText });
  } catch (error) {
    console.error("[extract-text] Error:", error);
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return jsonResponse({ error: message, code: "ai_failed" }, 500);
  }
});

/** Extract text from a PDF via Gemini multimodal. */
async function extractFromPDF(
  base64Data: string,
  apiKey: string,
): Promise<string> {
  const response = await fetch(LOVABLE_AI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Extract ALL text content from this document. Return ONLY the extracted text, preserving the original structure and formatting as much as possible. If this is a student assignment or test, include all written answers, selections, and work shown. Do not add any commentary or interpretation.",
            },
            {
              type: "image_url",
              image_url: { url: `data:application/pdf;base64,${base64Data}` },
            },
          ],
        },
      ],
      max_tokens: 4000,
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error("Rate limit exceeded. Please try again in a moment.");
    }
    if (response.status === 402) {
      throw new Error("AI credits exhausted. Please add funds to continue.");
    }
    const errorText = await response.text();
    console.error("[extract-text] AI error:", response.status, errorText);
    throw new Error(`AI extraction failed: ${response.status}`);
  }

  const aiResponse = await response.json();
  return aiResponse.choices?.[0]?.message?.content || "";
}

/** Extract text from an image via Gemini OCR. */
async function extractFromImage(
  base64Data: string,
  mimeType: string,
  apiKey: string,
): Promise<string> {
  const response = await fetch(LOVABLE_AI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Extract ALL text content from this image. This is a student assignment or test paper. Return ONLY the extracted text, including:
- All handwritten text (transcribe as accurately as possible)
- All printed text
- Any selected multiple choice answers (note which options are marked)
- Any work shown, calculations, or diagrams with labels
Preserve the original structure. Do not add any commentary or interpretation.`,
            },
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${base64Data}` },
            },
          ],
        },
      ],
      max_tokens: 4000,
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error("Rate limit exceeded. Please try again in a moment.");
    }
    if (response.status === 402) {
      throw new Error("AI credits exhausted. Please add funds to continue.");
    }
    const errorText = await response.text();
    console.error("[extract-text] AI error:", response.status, errorText);
    throw new Error(`AI extraction failed: ${response.status}`);
  }

  const aiResponse = await response.json();
  return aiResponse.choices?.[0]?.message?.content || "";
}
