import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { rawNotes } = await req.json() as { rawNotes: string };

    if (!rawNotes?.trim()) {
      return new Response(
        JSON.stringify({ error: "No notes provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    console.log("Formatting teacher note...");

    const systemPrompt = `You are an expert teaching assistant helping educators format their notes.

Your task is to take raw, unstructured teacher notes and convert them into a clean, professional formatted note.

CRITICAL RULES:
- Preserve ALL names EXACTLY as written (including apostrophes like O'Connor, special characters, etc.)
- Preserve ALL dates and times exactly as written
- Never add information that wasn't in the original notes
- If a section doesn't apply, omit it entirely (don't include empty sections)

OUTPUT FORMAT (use only sections that apply):
---
# Quick Note — [Date if present, otherwise today's date]

## Students Mentioned
- [List any student names mentioned]

## Parent Contact
- [Any parent communication details]

## Reminders / Follow-ups
- [Any reminders or follow-up items]

## Meeting Notes
- [Any meeting-related notes]

## Action Items
- [ ] [Action item 1]
- [ ] [Action item 2]

## Additional Notes
[Any other content that doesn't fit above sections]
---

Guidelines:
- Use markdown formatting
- Keep bullet points concise
- Action items should use checkbox format: - [ ]
- If the note is very simple, keep the output simple (don't force sections)
- Maintain the teacher's voice and intent`;

    const response = await fetch(LOVABLE_AI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Please format these teacher notes:\n\n${rawNotes}` },
        ],
        max_tokens: 2000,
        temperature: 0.3,
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
    const formattedNote = aiResponse.choices?.[0]?.message?.content || "";

    console.log("Note formatted successfully");

    return new Response(
      JSON.stringify({ formattedNote }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error formatting note:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
