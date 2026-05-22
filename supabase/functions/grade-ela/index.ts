/**
 * =============================================================================
 * GRADE ELA EDGE FUNCTION - BOTTOR ASSIST
 * =============================================================================
 *
 * ELA/Writing grading pipeline:
 * 1. Interpret rubric (if provided) → extract criteria, levels, points
 * 2. Analyze student work against rubric or default writing criteria
 * 3. Generate scores, strengths, areas for improvement, next step
 *
 * Uses Lovable AI Gateway (Claude-compatible) for analysis.
 * =============================================================================
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

// Default ELA rubric when none provided (6+1 Writing Traits simplified)
const DEFAULT_ELA_RUBRIC = {
  scale: 100,
  criteria: [
    { name: "Ideas & Content", maxPoints: 25, description: "Focus, clarity, development of ideas with supporting details" },
    { name: "Organization", maxPoints: 20, description: "Structure, transitions, logical flow, introduction and conclusion" },
    { name: "Voice", maxPoints: 15, description: "Engagement, tone appropriate to audience and purpose" },
    { name: "Word Choice", maxPoints: 15, description: "Vocabulary, precise language, avoiding repetition" },
    { name: "Sentence Fluency", maxPoints: 15, description: "Sentence variety, rhythm, flow" },
    { name: "Conventions", maxPoints: 10, description: "Spelling, grammar, punctuation, capitalization" },
  ],
};

interface ELAGradeRequest {
  student_work: string;
  student_name?: string;
  rubric_text?: string;
  grade_level?: string;
  assignment_type?: string;
  assignment_doc_text?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: ELAGradeRequest = await req.json();
    const {
      student_work,
      student_name = "Student",
      rubric_text,
      grade_level,
      assignment_type,
      assignment_doc_text,
    } = body;

    if (!student_work?.trim()) {
      return new Response(JSON.stringify({ error: "No student work provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    console.log(`[grade-ela] Starting ELA grading for: ${student_name}`);
    console.log(`[grade-ela] Student work length: ${student_work.length} chars`);
    console.log(`[grade-ela] Rubric provided: ${!!rubric_text}`);
    console.log(`[grade-ela] Assignment context provided: ${!!assignment_doc_text}`);
    console.log(`[grade-ela] Grade level: ${grade_level || "unspecified"}`);
    console.log(`[grade-ela] Assignment type: ${assignment_type || "unspecified"}`);

    // Build the grading prompt
    const { systemPrompt, userPrompt } = buildELAPrompts({
      studentWork: student_work,
      studentName: student_name,
      rubricText: rubric_text,
      gradeLevel: grade_level,
      assignmentType: assignment_type,
      assignmentDocText: assignment_doc_text,
    });

    console.log(`[grade-ela] System prompt length: ${systemPrompt.length}`);
    console.log(`[grade-ela] User prompt length: ${userPrompt.length}`);

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
          { role: "user", content: userPrompt },
        ],
        max_tokens: 4000,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds to continue." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await response.text();
      console.error("[grade-ela] AI error:", response.status, errorText);
      throw new Error(`AI grading failed: ${response.status}`);
    }

    const aiResponse = await response.json();
    const content = aiResponse.choices?.[0]?.message?.content || "";

    console.log("[grade-ela] AI response received, parsing...");
    console.log("[grade-ela] Raw response preview:", content.substring(0, 500));

    // Parse the JSON response
    let gradingResult;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        gradingResult = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in response");
      }

      // Normalize the response
      gradingResult = normalizeELAResult(gradingResult, student_name, rubric_text);
    } catch (parseError) {
      console.error("[grade-ela] Failed to parse AI response:", parseError);
      // Fallback result
      gradingResult = {
        student_name: student_name,
        score: "N/A",
        confidence: 50,
        strengths: ["Unable to parse AI response - please review manually"],
        areas_for_improvement: ["Manual review required"],
        next_step: "Please review this writing and provide personalized feedback.",
        teacher_notes: "AI response could not be parsed. Manual grading recommended.",
        consistency_check: { passed: true, adjustments: [] },
      };
    }

    console.log("[grade-ela] ELA grading complete, score:", gradingResult.score);

    return new Response(JSON.stringify(gradingResult), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[grade-ela] Error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

/**
 * Build ELA grading prompts
 */
function buildELAPrompts(params: {
  studentWork: string;
  studentName: string;
  rubricText?: string;
  gradeLevel?: string;
  assignmentType?: string;
  assignmentDocText?: string;
}): { systemPrompt: string; userPrompt: string } {
  const { studentWork, studentName, rubricText, gradeLevel, assignmentType, assignmentDocText } = params;

  // Determine rubric to use
  const rubricSection = rubricText?.trim()
    ? `TEACHER-PROVIDED RUBRIC:
${rubricText}

Use this rubric EXACTLY as provided. Extract criteria and point values from it.

RUBRIC FIDELITY GUARDRAILS (MANDATORY):
- Use ONLY the criteria provided in the teacher's rubric above. Do not invent, substitute, or supplement criteria from any default framework (e.g., 6+1 Traits), even if you believe additional criteria would be relevant.
- If the teacher's rubric has N criteria, your "criterion_breakdown" array MUST contain EXACTLY N entries with names that match the rubric's criteria.
- Score each criterion INDEPENDENTLY based only on evidence relevant to that criterion. Do not adjust scores to match an overall impression of the work.
- A criterion may only receive FULL POINTS (e.g., 25/25) if there are ZERO weaknesses, errors, or improvement notes related to that criterion anywhere in your response (including areas_for_improvement and teacher_notes). Before returning, verify this consistency — if a criterion has full marks but you also flagged a related issue, reduce its score.`
    : `DEFAULT WRITING RUBRIC (6+1 Traits):\n${JSON.stringify(DEFAULT_ELA_RUBRIC.criteria, null, 2)}\n\nTotal: ${DEFAULT_ELA_RUBRIC.scale} points`;


  const gradeContext = gradeLevel ? `Grade Level: ${gradeLevel}` : "";
  const assignmentContext = assignmentType ? `Assignment Type: ${assignmentType}` : "";

  const sourceMaterialSection = assignmentDocText?.trim()
    ? `\nASSIGNMENT CONTEXT / SOURCE MATERIAL (reference text the student was responding to — use to verify quotes and flag misreadings):\n---\n${assignmentDocText}\n---\n`
    : "";

  const systemPrompt = `You are Bottor Assist, an expert ELA/Writing teacher assistant. Your role is to grade student writing fairly and provide constructive, growth-oriented feedback.

GRADING PHILOSOPHY:
- Be encouraging but honest
- Focus on specific evidence from the student's work
- Provide actionable feedback that helps students improve
- Consider grade-level expectations when scoring
- Award credit for effort and partial success
${assignmentDocText?.trim() ? "- When source material is provided, verify any quotes against it and call out misinterpretations or unsupported claims" : ""}

${rubricSection}

SCORING RULES:
1. Score each criterion on a scale from 0 to its max points
2. Base scores on specific evidence from the writing
3. Use the full range of the scale - don't cluster in the middle
4. If rubric has performance levels (Excellent, Proficient, etc.), map to points:
   - Excellent/Exemplary = 100% of criterion points
   - Proficient/Competent = 75% of criterion points
   - Developing/Basic = 50% of criterion points
   - Beginning/Emerging = 25% of criterion points

OUTPUT FORMAT:
Return ONLY valid JSON with this structure:
{
  "earned": <total points earned>,
  "possible": <total possible points>,
  "percent": <percentage as integer>,
  "letter_grade": "<A/B/C/D/F with optional +/->",
  "criterion_breakdown": [
    {
      "criterion": "<criterion name>",
      "earned": <points earned>,
      "possible": <max points>,
      "level": "<performance level if applicable>",
      "evidence": "<brief quote or description from student work>"
    }
  ],
  "strengths": [
    "<specific strength with evidence>",
    "<another strength>",
    "<third strength if applicable>"
  ],
  "areas_for_improvement": [
    "<specific area with example>",
    "<another area>",
    "<third area if applicable>"
  ],
  "next_step": "<one specific, actionable recommendation for the student>",
  "confidence": <0-100 confidence score>,
  "teacher_notes": "<optional notes about grading decisions or concerns>"
}

CRITICAL RULES:
- Strengths and areas_for_improvement must be arrays of strings, not single strings
- Each strength/improvement should cite specific evidence from the writing
- "next_step" should be a single, actionable sentence
- Do NOT invent content that isn't in the student work
- If writing is too brief to evaluate, note this and lower confidence`;

  const userPrompt = `${gradeContext ? gradeContext + "\n" : ""}${assignmentContext ? assignmentContext + "\n\n" : ""}${sourceMaterialSection}
STUDENT NAME: ${studentName}

STUDENT WRITING:
---
${studentWork}
---

Grade this writing according to the rubric. Return your assessment as valid JSON only.`;

  return { systemPrompt, userPrompt };
}

/**
 * Normalize and validate the ELA grading result
 */
function normalizeELAResult(
  result: Record<string, unknown>,
  studentName: string,
  rubricText?: string
): Record<string, unknown> {
  // Ensure arrays are arrays
  const strengths = Array.isArray(result.strengths) 
    ? result.strengths 
    : typeof result.strengths === 'string' 
      ? [result.strengths]
      : ["Work shows effort"];

  const areasForImprovement = Array.isArray(result.areas_for_improvement)
    ? result.areas_for_improvement
    : typeof result.areas_for_improvement === 'string'
      ? [result.areas_for_improvement]
      : ["Continue practicing writing skills"];

  // Calculate score string
  const earned = typeof result.earned === 'number' ? result.earned : 0;
  const possible = typeof result.possible === 'number' ? result.possible : 100;
  const percent = typeof result.percent === 'number' 
    ? result.percent 
    : Math.round((earned / possible) * 100);

  // Determine letter grade if not provided
  let letterGrade = result.letter_grade;
  if (!letterGrade) {
    if (percent >= 93) letterGrade = "A";
    else if (percent >= 90) letterGrade = "A-";
    else if (percent >= 87) letterGrade = "B+";
    else if (percent >= 83) letterGrade = "B";
    else if (percent >= 80) letterGrade = "B-";
    else if (percent >= 77) letterGrade = "C+";
    else if (percent >= 73) letterGrade = "C";
    else if (percent >= 70) letterGrade = "C-";
    else if (percent >= 67) letterGrade = "D+";
    else if (percent >= 63) letterGrade = "D";
    else if (percent >= 60) letterGrade = "D-";
    else letterGrade = "F";
  }

  return {
    student_name: studentName,
    score: `${earned}/${possible} (${percent}%)`,
    letter_grade: letterGrade,
    percent,
    earned,
    possible,
    strengths: strengths.slice(0, 5), // Max 5 strengths
    areas_for_improvement: areasForImprovement.slice(0, 5), // Max 5 areas
    next_step: typeof result.next_step === 'string' 
      ? result.next_step 
      : "Continue practicing your writing skills.",
    confidence: typeof result.confidence === 'number' 
      ? Math.min(100, Math.max(0, result.confidence))
      : 70,
    criterion_breakdown: Array.isArray(result.criterion_breakdown) 
      ? result.criterion_breakdown 
      : undefined,
    teacher_notes: typeof result.teacher_notes === 'string' 
      ? result.teacher_notes 
      : undefined,
    rubric_used: rubricText?.trim() 
      ? {
          scale: typeof result.possible === 'number' ? result.possible : 100,
          criteria_count: Array.isArray(result.criterion_breakdown) 
            ? result.criterion_breakdown.length 
            : 6,
          source: "teacher",
        }
      : {
          scale: DEFAULT_ELA_RUBRIC.scale,
          criteria_count: DEFAULT_ELA_RUBRIC.criteria.length,
          source: "default",
        },
  };
}
