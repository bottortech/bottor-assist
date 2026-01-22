/**
 * =============================================================================
 * GRADE PAPER EDGE FUNCTION
 * =============================================================================
 * 
 * NEXT.JS MIGRATION: app/api/grade-paper/route.ts
 * 
 * PURPOSE: Generate AI-powered grade suggestions and feedback for student work.
 * 
 * INPUT:
 * - student_work: Extracted text from student submission
 * - grade_level: Grade level (e.g., "Grade 5")
 * - subject: Subject area (e.g., "Mathematics")
 * - assignment_type: Type (multiple_choice, constructed_response, essay)
 * - rubric: Grading rubric text
 * - answer_key: Optional answer key for reference
 * 
 * OUTPUT:
 * - score_suggestion: Suggested score aligned to rubric
 * - strengths: What the student did well
 * - areas_for_improvement: Where the student can improve
 * - feedback_paragraph: Draft feedback in supportive teacher tone
 * 
 * ANTI-HALLUCINATION: All outputs are based strictly on provided inputs.
 * If information is missing, output "Not provided."
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

    console.log(`[grade-paper] Grading ${assignment_type} for ${grade_level} ${subject}`);

    // Build the grading prompt
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
            content: `You are an experienced ${subject || 'education'} teacher grading student work for ${grade_level || 'a student'}.

Your task is to evaluate the student's submission against the provided rubric and generate constructive feedback.

CRITICAL RULES:
1. Base your assessment ONLY on the student work provided - never assume or invent content
2. Apply the rubric criteria exactly as written
3. If an answer key is provided, use it as reference for correctness
4. If information is missing or unclear, state "Not provided" or "Unable to assess"
5. Be fair, supportive, and age-appropriate in your feedback
6. Focus on growth mindset - highlight what was done well before areas for improvement

OUTPUT FORMAT:
You MUST respond with valid JSON in exactly this format:
{
  "score_suggestion": "The suggested score based on rubric (e.g., '85/100', 'B+', '4/5 points', etc.)",
  "strengths": "2-4 specific things the student did well, with examples from their work",
  "areas_for_improvement": "2-3 specific areas where the student can improve, with actionable suggestions",
  "feedback_paragraph": "A 3-5 sentence feedback paragraph written directly to the student in a warm, supportive teacher tone. Start with what they did well, then address areas for growth, end with encouragement."
}`,
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        max_tokens: 1500,
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
      console.error("[grade-paper] AI error:", response.status, errorText);
      throw new Error(`AI grading failed: ${response.status}`);
    }

    const aiResponse = await response.json();
    const content = aiResponse.choices?.[0]?.message?.content || "";

    console.log("[grade-paper] AI response received, parsing...");

    // Parse the JSON response
    let gradingResult;
    try {
      // Try to extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        gradingResult = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in response");
      }
    } catch (parseError) {
      console.error("[grade-paper] Failed to parse AI response:", parseError);
      // Return a structured fallback
      gradingResult = {
        score_suggestion: "Unable to determine - please review manually",
        strengths: content.includes("strength") ? extractSection(content, "strength") : "Not provided",
        areas_for_improvement: content.includes("improve") ? extractSection(content, "improve") : "Not provided",
        feedback_paragraph: content.slice(0, 500) || "Not provided",
      };
    }

    console.log("[grade-paper] Grading complete");

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
 * Build the grading prompt with all context
 */
function buildGradingPrompt(request: GradeRequest): string {
  const { student_work, grade_level, subject, assignment_type, rubric, answer_key } = request;

  const typeLabels: Record<string, string> = {
    multiple_choice: "Multiple Choice",
    constructed_response: "Constructed Response",
    essay: "Essay",
  };

  const sections = [
    `## Assignment Context`,
    `- Grade Level: ${grade_level || "Not specified"}`,
    `- Subject: ${subject || "Not specified"}`,
    `- Assignment Type: ${typeLabels[assignment_type] || assignment_type || "Not specified"}`,
    "",
    `## Grading Rubric`,
    rubric,
    "",
  ];

  if (answer_key?.trim()) {
    sections.push(
      `## Answer Key / Correct Responses`,
      answer_key,
      ""
    );
  }

  sections.push(
    `## Student Work to Grade`,
    student_work,
    "",
    `Please evaluate this student work against the rubric and provide your assessment in JSON format.`
  );

  return sections.join("\n");
}

/**
 * Helper to extract a section from unstructured text
 */
function extractSection(text: string, keyword: string): string {
  const lines = text.split("\n");
  const relevantLines: string[] = [];
  let capturing = false;

  for (const line of lines) {
    if (line.toLowerCase().includes(keyword)) {
      capturing = true;
    }
    if (capturing) {
      relevantLines.push(line);
      if (relevantLines.length >= 5) break;
    }
  }

  return relevantLines.join(" ").slice(0, 300) || "Not provided";
}
