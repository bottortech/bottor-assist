/**
 * =============================================================================
 * EXTRACT TEXT EDGE FUNCTION
 * =============================================================================
 * 
 * NEXT.JS MIGRATION: app/api/extract-text/route.ts
 * 
 * PURPOSE: Extract text from uploaded PDF or image files.
 * Uses Lovable AI with vision capabilities for OCR fallback.
 * 
 * INPUT:
 * - file_data: Base64 encoded file content
 * - file_type: MIME type (application/pdf, image/jpeg, etc.)
 * - file_name: Original filename
 * 
 * OUTPUT:
 * - text: Extracted text content
 * =============================================================================
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { file_data, file_type, file_name } = await req.json();

    if (!file_data) {
      return new Response(
        JSON.stringify({ error: "No file data provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    console.log(`[extract-text] Processing file: ${file_name}, type: ${file_type}`);

    let extractedText = "";

    // For PDFs, try basic text extraction first
    if (file_type === "application/pdf") {
      extractedText = await extractFromPDF(file_data, LOVABLE_API_KEY);
    } else if (file_type.startsWith("image/")) {
      // For images, use vision model for OCR
      extractedText = await extractFromImage(file_data, file_type, LOVABLE_API_KEY);
    } else {
      return new Response(
        JSON.stringify({ error: "Unsupported file type" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[extract-text] Extracted ${extractedText.length} characters`);

    return new Response(
      JSON.stringify({ text: extractedText }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[extract-text] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/**
 * Extract text from PDF using AI vision (treats PDF pages as images)
 */
async function extractFromPDF(base64Data: string, apiKey: string): Promise<string> {
  // Use AI with vision to extract text from PDF
  // Gemini can process PDFs directly
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
              text: `Extract ALL text content from this document. Return ONLY the extracted text, preserving the original structure and formatting as much as possible. If this is a student assignment or test, include all written answers, selections, and work shown. Do not add any commentary or interpretation.`,
            },
            {
              type: "image_url",
              image_url: {
                url: `data:application/pdf;base64,${base64Data}`,
              },
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

/**
 * Extract text from image using AI vision (OCR)
 */
async function extractFromImage(base64Data: string, mimeType: string, apiKey: string): Promise<string> {
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
              image_url: {
                url: `data:${mimeType};base64,${base64Data}`,
              },
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
