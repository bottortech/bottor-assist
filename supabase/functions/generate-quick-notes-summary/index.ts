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
    const { notes } = await req.json() as { notes: QuickNotes };

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const prompt = buildSummaryPrompt(notes);

    console.log("Generating summary from quick notes...");

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
            content: `You are an expert teaching assistant helping educators summarize their lesson notes.
            
Your task is to create a clear, professional summary of the lesson based on the teacher's notes.

Guidelines:
- Be concise but comprehensive
- Use professional educational language
- If information is missing, explicitly state "Not provided" for that section
- Never hallucinate or make up information that wasn't provided
- Focus on what was actually taught and observed
- Highlight key learning outcomes and areas needing attention
- Keep the summary to 3-5 paragraphs maximum`,
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        max_tokens: 1000,
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
    const summary = aiResponse.choices?.[0]?.message?.content || "Unable to generate summary.";

    console.log("Summary generated successfully");

    return new Response(
      JSON.stringify({ summary }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error generating summary:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function buildSummaryPrompt(notes: QuickNotes): string {
  const sections = [
    `**Subject:** ${notes.subject || "Not provided"}`,
    `**Grade Level:** ${notes.grade || "Not provided"}`,
    `**Lesson Topic:** ${notes.topic || "Not provided"}`,
    "",
    "## Teacher's Notes",
    "",
    `**What we did today:**`,
    notes.whatWeDid || "Not provided.",
    "",
    `**What students struggled with:**`,
    notes.struggles || "Not provided.",
    "",
    `**Students/groups needing attention:**`,
    notes.attentionNeeded || "Not provided.",
    "",
    `**Homework/Assessment/Next steps:**`,
    notes.nextSteps || "Not provided.",
  ];

  return `Please create a professional lesson summary based on these teacher notes:\n\n${sections.join("\n")}`;
}
