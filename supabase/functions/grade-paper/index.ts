/**
 * =============================================================================
 * GRADE PAPER EDGE FUNCTION - BOTTOR ASSIST
 * =============================================================================
 * 
 * NEXT.JS MIGRATION: app/api/grade-paper/route.ts
 * 
 * PURPOSE: Grade 8th grade ELA/Social Studies "Graphic Essay Organizer" assignments.
 * 
 * RUBRIC: 15 points total (5 points per source × 3 sources)
 * Each source: Title(1) + Author(1) + Central Idea(1) + Evidence(1) + Analysis(1)
 * 
 * SCORING:
 * - Full credit (1): present, relevant, and accurate
 * - Partial (0.5): present but vague, partly incorrect, or not clearly tied to prompt
 * - No credit (0): missing, off-topic, copied prompt only, or illegible
 * 
 * ANTI-HALLUCINATION: Grade only what is present. Never invent missing info.
 * =============================================================================
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

interface GradeRequest {
  student_work: string;
  grade_level: string;
  subject: string;
  assignment_type: string;
  rubric: string;
  answer_key?: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: GradeRequest = await req.json();
    const { student_work, grade_level, subject, assignment_type, rubric, answer_key } = body;

    if (!student_work?.trim()) {
      return new Response(
        JSON.stringify({ error: "No student work provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!rubric?.trim()) {
      return new Response(
        JSON.stringify({ error: "No rubric provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    console.log(`[grade-paper] Grading Graphic Essay Organizer for ${grade_level} ${subject}`);

    // Build the grading prompt with specific rubric
    const prompt = buildGradingPrompt(body);

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
            content: `You are Bottor Assist, an 8th grade ELA/Social Studies grading assistant.

You are grading a "Graphic Essay Organizer" that is worth 15 points total.

CRITICAL GRADING RULES:
1. Grade ONLY what is present on the organizer - do NOT invent missing information
2. If handwriting is unclear or illegible, explicitly state "illegible/unclear" and do NOT assume what it says
3. Give point-by-point scoring using the rubric exactly
4. Provide brief, teacher-quality feedback: what's correct, what's missing, and exactly how to fix it
5. Keep educators fully in control: phrase all suggestions as recommendations

RUBRIC (15 points total):
Each source is worth 5 points, with these categories:
1) Source Title (1 pt) - The title of the source material
2) Source Author (1 pt) - The author's name
3) Central idea of the source (1 pt) - The main idea or thesis
4) Evidence (cited) that supports the answer (1 pt) - A specific quote or detail with citation
5) Analysis question/response for that source (1 pt) - Response to the analysis prompt

NOTE: If the organizer's prompt replaces "analysis question" with a specific analysis item
(e.g., "According to this source, what was the consequence of fascism?"),
treat that required analysis item as the 1-pt analysis category.

SCORING RULES:
- Full credit (1): present, relevant, and accurate
- Partial (0.5): present but vague, partly incorrect, or not clearly tied to the prompt
- No credit (0): missing, off-topic, copied prompt only, or illegible

OUTPUT FORMAT:
You MUST respond with valid JSON in exactly this format:
{
  "total_score": <number out of 15>,
  "per_source": [
    {
      "source_number": 1,
      "source_score": <number out of 5>,
      "title": { "score": <0|0.5|1>, "notes": "<what was written or 'missing'>" },
      "author": { "score": <0|0.5|1>, "notes": "<what was written or 'missing'>" },
      "central_idea": { "score": <0|0.5|1>, "notes": "<what was written or 'missing/vague'>" },
      "evidence": { "score": <0|0.5|1>, "notes": "<quote present? cited? specific?>" },
      "analysis": { "score": <0|0.5|1>, "notes": "<response quality or 'missing'>" }
    },
    // ... repeat for sources 2 and 3 if present
  ],
  "evidence_quality": "<overall notes on citation quality, specificity of quotes/details>",
  "actionable_feedback": [
    "<bullet 1: specific actionable item>",
    "<bullet 2: specific actionable item>",
    // 3-6 bullets total
  ],
  "teacher_note": "<note about any illegible handwriting, missing fields, or grading considerations>",
  "feedback_paragraph": "<A 3-5 sentence paragraph written directly to the student in warm, supportive teacher tone. Start with what they did well, address areas for growth, end with encouragement.>"
}`,
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        max_tokens: 2000,
        temperature: 0.5,
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
      console.error("[grade-paper] AI error:", response.status, errorText);
      throw new Error(`AI grading failed: ${response.status}`);
    }

    const aiResponse = await response.json();
    const content = aiResponse.choices?.[0]?.message?.content || "";

    console.log("[grade-paper] AI response received, parsing...");

    // Parse the JSON response
    let gradingResult;
    try {
      // Extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        gradingResult = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in response");
      }

      // Validate required fields exist
      if (typeof gradingResult.total_score !== 'number') {
        gradingResult.total_score = 0;
      }
      if (!Array.isArray(gradingResult.per_source)) {
        gradingResult.per_source = [];
      }
      if (!Array.isArray(gradingResult.actionable_feedback)) {
        gradingResult.actionable_feedback = ["Please review the submission manually."];
      }
      if (!gradingResult.teacher_note) {
        gradingResult.teacher_note = "AI grading complete. Please verify scores.";
      }
      if (!gradingResult.feedback_paragraph) {
        gradingResult.feedback_paragraph = "Please review this work and provide personalized feedback.";
      }

      // Map to legacy format for UI compatibility
      gradingResult.score_suggestion = `${gradingResult.total_score}/15`;
      gradingResult.strengths = gradingResult.per_source
        .filter((s: any) => s.source_score >= 4)
        .map((s: any) => `Source ${s.source_number}: Strong work (${s.source_score}/5)`)
        .join("; ") || "See per-source breakdown";
      gradingResult.areas_for_improvement = gradingResult.actionable_feedback.join("\n• ");

    } catch (parseError) {
      console.error("[grade-paper] Failed to parse AI response:", parseError);
      gradingResult = {
        total_score: 0,
        score_suggestion: "Unable to determine - please review manually",
        per_source: [],
        evidence_quality: "Unable to assess",
        actionable_feedback: ["Manual review required - AI parsing failed"],
        teacher_note: "AI response could not be parsed. Please grade manually.",
        feedback_paragraph: "Please review this work and provide personalized feedback.",
        strengths: "Not provided",
        areas_for_improvement: "Not provided",
      };
    }

    console.log("[grade-paper] Grading complete, total score:", gradingResult.total_score);

    return new Response(
      JSON.stringify(gradingResult),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[grade-paper] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/**
 * Build the grading prompt with Graphic Essay Organizer context
 */
function buildGradingPrompt(request: GradeRequest): string {
  const { student_work, grade_level, subject, assignment_type, rubric, answer_key } = request;

  const sections = [
    `## Assignment: Graphic Essay Organizer`,
    `- Grade Level: ${grade_level || "8th Grade"}`,
    `- Subject: ${subject || "ELA/Social Studies"}`,
    `- Assignment Type: ${assignment_type || "Graphic Essay Organizer"}`,
    `- Total Points: 15 (5 points per source × 3 sources)`,
    "",
    `## Grading Rubric`,
    rubric || `Each source (5 points):
- Source Title (1 pt)
- Source Author (1 pt)  
- Central idea of the source (1 pt)
- Evidence with citation (1 pt)
- Analysis question response (1 pt)`,
    "",
  ];

  if (answer_key?.trim()) {
    sections.push(
      `## Answer Key / Expected Responses`,
      answer_key,
      ""
    );
  }

  sections.push(
    `## Student Work to Grade`,
    `(Grade ONLY what is visible below. Do not assume or invent content.)`,
    "",
    student_work,
    "",
    `Please evaluate this Graphic Essay Organizer against the rubric and provide your assessment in the specified JSON format.`,
    `Remember: If anything is illegible, say so. If anything is missing, score it 0.`
  );

  return sections.join("\n");
}
