import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

interface QuickNotes {
  subject: string;
  grade: string;
  topic: string;
  whatWeDid: string;
  struggles: string;
  attentionNeeded: string;
  nextSteps: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { notes, summary } = await req.json() as { notes: QuickNotes; summary: string };

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    console.log("Generating parent messages...");

    const response = await fetch(LOVABLE_AI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `You are an expert teaching assistant helping educators communicate with parents.

Your task is to generate TWO versions of a parent message based on the lesson summary:

**VERSION A - Warm & Supportive (4-6 sentences):**
- Friendly, encouraging tone
- Highlights what students learned
- Mentions any homework or follow-up gently
- Supportive and reassuring
- No educational jargon
- No clinical language or diagnoses

**VERSION B - SMS-Ready (2-3 sentences max, under 160 characters if possible):**
- Ultra-concise
- Key info only: topic learned, any action needed
- Friendly but brief

CRITICAL RULES:
- Never hallucinate or add information not in the notes
- If information is missing, don't mention it - focus on what IS provided
- Never mention specific student names in parent messages
- Keep language accessible to all parents
- Be encouraging, never alarming

Format your response EXACTLY like this:
---WARM---
[Your warm message here]
---SMS---
[Your SMS message here]`,
          },
          {
            role: "user",
            content: buildPrompt(notes, summary),
          },
        ],
        max_tokens: 500,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add funds to continue." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const aiResponse = await response.json();
    const content = aiResponse.choices?.[0]?.message?.content || "";

    // Parse the two message types
    const { warmMessage, smsMessage } = parseMessages(content);

    console.log("Parent messages generated successfully");

    return new Response(
      JSON.stringify({ warmMessage, smsMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error generating parent messages:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function buildPrompt(notes: QuickNotes, summary: string): string {
  return `Based on this lesson information, generate parent messages:

**Subject:** ${notes.subject || "Not provided"}
**Grade:** ${notes.grade || "Not provided"}
**Topic:** ${notes.topic || "Not provided"}

**Lesson Summary:**
${summary}

**Homework/Next Steps:**
${notes.nextSteps || "Not provided"}

Generate the two message versions now.`;
}

function parseMessages(content: string): { warmMessage: string; smsMessage: string } {
  let warmMessage = "Unable to generate message.";
  let smsMessage = "Unable to generate message.";

  try {
    const warmMatch = content.match(/---WARM---\s*([\s\S]*?)(?=---SMS---|$)/i);
    const smsMatch = content.match(/---SMS---\s*([\s\S]*?)$/i);

    if (warmMatch && warmMatch[1]) {
      warmMessage = warmMatch[1].trim();
    }
    if (smsMatch && smsMatch[1]) {
      smsMessage = smsMatch[1].trim();
    }
  } catch (e) {
    console.error("Error parsing messages:", e);
    // If parsing fails, try to use the whole content as warm message
    if (content && content.length > 10) {
      warmMessage = content.trim();
    }
  }

  return { warmMessage, smsMessage };
}
