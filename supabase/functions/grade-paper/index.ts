/**
 * =============================================================================
 * GRADE PAPER EDGE FUNCTION - BOTTOR ASSIST
 * =============================================================================
 * 
 * Two distinct grading modes:
 * 1. FEEDBACK-ONLY MODE: No rubric/answer key → qualitative feedback, no score
 * 2. RUBRIC/SCORING MODE: Rubric and/or answer key → numeric score + feedback
 * 
 * GUARDRAILS:
 * - Never invent rubric criteria, point values, or answer keys
 * - If information is missing, say so clearly
 * - Be accurate, conservative, and transparent
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
  grade_level?: string;
  subject?: string;
  assignment_type?: string;
  rubric?: string;           // Combined rubric text (extracted + pasted)
  answer_key?: string;       // Combined answer key text (extracted + pasted)
  prompt_text?: string;      // Teacher's specific analysis question
  assignment_doc_text?: string;
  // Legacy fields for backward compatibility
  grading_mode?: 'scoring' | 'feedback-only';
  scoring_mode?: 'feedback-only' | 'auto-score' | 'rubric-based';
  auto_score_settings?: {
    totalPoints: number | null;
    pointsPerQuestion: number | null;
    questionCount: number | null;
    partialCreditAllowed: boolean;
    usePointsPerQuestion: boolean;
  };
  quick_rubric_categories?: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: GradeRequest = await req.json();
    const { 
      student_work, 
      grade_level, 
      subject,
      assignment_type,
      rubric, 
      answer_key, 
      prompt_text,
      assignment_doc_text,
      auto_score_settings,
      quick_rubric_categories
    } = body;

    if (!student_work?.trim()) {
      return new Response(
        JSON.stringify({ error: "No student work provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Determine grading mode based on presence of grading criteria
    const hasRubric = rubric && rubric.trim().length > 0;
    const hasAnswerKey = answer_key && answer_key.trim().length > 0;
    const hasQuickRubric = quick_rubric_categories && quick_rubric_categories.trim().length > 0;
    const hasGradingCriteria = hasRubric || hasAnswerKey || hasQuickRubric;
    
    const gradingMode = hasGradingCriteria ? 'rubric_scoring' : 'feedback_only';
    
    console.log(`[grade-paper] Mode: ${gradingMode}`);
    console.log(`[grade-paper] Has rubric: ${hasRubric}, Has answer key: ${hasAnswerKey}, Has quick rubric: ${hasQuickRubric}`);
    console.log(`[grade-paper] Grade level: ${grade_level || 'unspecified'}, Subject: ${subject || 'unspecified'}`);
    
    // Build prompts based on mode
    const { systemPrompt, userPrompt } = buildPrompts({
      mode: gradingMode,
      studentWork: student_work,
      subject,
      gradeLevel: grade_level,
      assignmentType: assignment_type,
      rubric,
      answerKey: answer_key,
      assignmentDocText: assignment_doc_text,
      autoScoreSettings: auto_score_settings,
      quickRubricCategories: quick_rubric_categories
    });

    console.log(`[grade-paper] System prompt length: ${systemPrompt.length}`);
    console.log(`[grade-paper] User prompt length: ${userPrompt.length}`);

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
    console.log("[grade-paper] Raw response preview:", content.substring(0, 500));

    // Parse the JSON response
    let gradingResult;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        gradingResult = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in response");
      }

      // Normalize the response format
      gradingResult = normalizeGradingResult(gradingResult, gradingMode);

    } catch (parseError) {
      console.error("[grade-paper] Failed to parse AI response:", parseError);
      gradingResult = {
        mode: gradingMode,
        score_suggestion: "N/A",
        suggested_score: gradingMode === 'feedback_only' ? { display: "N/A" } : undefined,
        strengths: ["Unable to parse AI response"],
        strengths_list: ["Unable to parse AI response"],
        areas_for_improvement: ["Manual review required - AI parsing failed"],
        improvements_list: ["Manual review required - AI parsing failed"],
        feedback_paragraph: "Please review this work and provide personalized feedback.",
        draft_feedback: "Please review this work and provide personalized feedback.",
        teacher_notes: ["AI response could not be parsed. Manual grading recommended."]
      };
    }

    console.log("[grade-paper] Grading complete, mode:", gradingResult.mode, "score:", gradingResult.score_suggestion);

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
 * Build system and user prompts based on grading mode
 */
function buildPrompts(params: {
  mode: 'feedback_only' | 'rubric_scoring';
  studentWork: string;
  subject?: string;
  gradeLevel?: string;
  assignmentType?: string;
  rubric?: string;
  answerKey?: string;
  assignmentDocText?: string;
  autoScoreSettings?: {
    totalPoints: number | null;
    pointsPerQuestion: number | null;
    questionCount: number | null;
    partialCreditAllowed: boolean;
    usePointsPerQuestion: boolean;
  };
  quickRubricCategories?: string;
}): { systemPrompt: string; userPrompt: string } {
  
  if (params.mode === 'feedback_only') {
    return buildFeedbackOnlyPrompts(params);
  } else {
    return buildRubricScoringPrompts(params);
  }
}

/**
 * FEEDBACK-ONLY MODE PROMPTS
 * No rubric, no scoring rules → qualitative feedback only
 */
function buildFeedbackOnlyPrompts(params: {
  studentWork: string;
  subject?: string;
  gradeLevel?: string;
  assignmentType?: string;
}): { systemPrompt: string; userPrompt: string } {
  
  const systemPrompt = `You are Bottor Assist, a teacher-facing grading assistant. You must be accurate, conservative, and transparent. Never invent rubric criteria, point values, or answer keys. If information is missing, say so clearly and proceed in feedback-only mode. Do not guess.`;

  const userPrompt = `Teacher context (optional):
Subject: ${params.subject || "Not provided"}
Grade level: ${params.gradeLevel || "Not provided"}
Assignment type: ${params.assignmentType || "Not provided"}

Inputs:

Student work text (OCR / extracted):
${params.studentWork}

Task:
You are in FEEDBACK-ONLY MODE. Do NOT generate a numeric score.

Return:
- Strengths (3–6 bullets) grounded in the student's work
- Areas for Improvement (3–6 bullets) grounded in the student's work
- Draft Feedback (1 short paragraph written directly to the student)
- Teacher Notes (1–3 bullets: what you would check if a rubric/answer key were provided)

Output format (STRICT JSON):
{
  "mode": "feedback_only",
  "suggested_score": "N/A",
  "strengths": ["..."],
  "areas_for_improvement": ["..."],
  "draft_feedback": "...",
  "teacher_notes": ["..."]
}`;

  return { systemPrompt, userPrompt };
}

/**
 * RUBRIC/SCORING MODE PROMPTS
 * Points rubric + optional answer key → numeric score + feedback
 */
function buildRubricScoringPrompts(params: {
  studentWork: string;
  subject?: string;
  gradeLevel?: string;
  assignmentType?: string;
  rubric?: string;
  answerKey?: string;
  assignmentDocText?: string;
  autoScoreSettings?: {
    totalPoints: number | null;
    pointsPerQuestion: number | null;
    questionCount: number | null;
    partialCreditAllowed: boolean;
    usePointsPerQuestion: boolean;
  };
  quickRubricCategories?: string;
}): { systemPrompt: string; userPrompt: string } {

  const systemPrompt = `You are Bottor Assist, a teacher-facing grading assistant. You must be accurate, conservative, and transparent.

Rules:
1. NEVER guess rubric criteria, point values, or correct answers.
2. If the rubric is present, grade ONLY using rubric criteria and point values.
3. If an answer key is present, use it to evaluate correctness per question exactly.
4. If both rubric and answer key are present: use the answer key for correctness and the rubric to guide feedback language and partial credit.
5. If something cannot be determined from the student work (illegible, missing, ambiguous), mark it as "unclear" and assign 0 points unless the rubric explicitly defines partial credit for that case.
6. Show your work: include a rubric breakdown with points earned per criterion and short evidence.
7. Total score must equal the sum of awarded points.
8. Be consistent: do not contradict yourself between breakdown and narrative.`;

  // Build the combined rubric text
  let rubricSection = "";
  if (params.rubric?.trim()) {
    rubricSection = params.rubric;
  }
  if (params.quickRubricCategories?.trim()) {
    rubricSection += (rubricSection ? "\n\n" : "") + `Quick Rubric Categories: ${params.quickRubricCategories}`;
  }

  // Build scoring rules from auto-score settings if provided
  let scoringRulesText = "";
  if (params.autoScoreSettings) {
    const settings = params.autoScoreSettings;
    if (settings.usePointsPerQuestion && settings.pointsPerQuestion !== null && settings.questionCount !== null) {
      scoringRulesText = `Points per question: ${settings.pointsPerQuestion}, Question count: ${settings.questionCount}, Total possible: ${settings.pointsPerQuestion * settings.questionCount}`;
    } else if (settings.totalPoints !== null) {
      scoringRulesText = `Total points possible: ${settings.totalPoints}`;
    }
    if (settings.partialCreditAllowed) {
      scoringRulesText += ". Partial credit is allowed.";
    }
  }

  const userPrompt = `Teacher context (optional):
Subject: ${params.subject || "Not provided"}
Grade level: ${params.gradeLevel || "Not provided"}
Assignment type: ${params.assignmentType || "Not provided"}

Inputs:

Student work text (OCR / extracted):
${params.studentWork}

Rubric text (REQUIRED for this mode):
${rubricSection || "(No explicit rubric provided - use answer key for correctness evaluation)"}

Answer key text (optional):
${params.answerKey || ""}

Scoring rules (optional; if present, may be used ONLY if rubric does not define points):
${scoringRulesText || ""}

${params.assignmentDocText ? `Assignment document context:\n${params.assignmentDocText}\n` : ""}

Task:
Grade the student work using the rubric provided.

1. Parse the rubric into criteria/categories with point values.
2. For each criterion, award points based ONLY on evidence found in the student work.
3. If an answer key is provided and the assignment is question-based, evaluate each question against the answer key and use that evidence to award rubric points and/or partial credit.
4. Compute total points earned and total possible points.
5. Produce feedback that references rubric criteria explicitly.

Return:
A) Suggested Score as "earned/possible" (example "17/20") and percent
B) Rubric Breakdown: list each criterion with possible points, earned points, and 1–2 evidence sentences from the student work
C) Strengths (3–6 bullets)
D) Areas for Improvement (3–6 bullets)
E) Draft Feedback (short paragraph to student)
F) Teacher Notes (1–3 bullets: anything unclear, OCR issues, or rubric ambiguities)

Output format (STRICT JSON):
{
  "mode": "rubric_scoring",
  "suggested_score": {
    "earned_points": 0,
    "possible_points": 0,
    "display": "0/0",
    "percent": 0
  },
  "rubric_breakdown": [
    {
      "criterion": "...",
      "possible_points": 0,
      "earned_points": 0,
      "evidence": "..."
    }
  ],
  "strengths": ["..."],
  "areas_for_improvement": ["..."],
  "draft_feedback": "...",
  "teacher_notes": ["..."]
}`;

  return { systemPrompt, userPrompt };
}

/**
 * Normalize the grading result to a consistent format
 */
function normalizeGradingResult(
  result: Record<string, unknown>, 
  mode: 'feedback_only' | 'rubric_scoring'
): Record<string, unknown> {
  
  // Ensure mode is set
  result.mode = result.mode || mode;
  
  // Normalize strengths
  if (Array.isArray(result.strengths)) {
    result.strengths_list = result.strengths;
  } else if (Array.isArray(result.strengths_list)) {
    result.strengths = result.strengths_list;
  } else {
    result.strengths = [];
    result.strengths_list = [];
  }
  
  // Normalize areas for improvement
  if (Array.isArray(result.areas_for_improvement)) {
    result.improvements_list = result.areas_for_improvement;
  } else if (Array.isArray(result.improvements_list)) {
    result.areas_for_improvement = result.improvements_list;
  } else {
    result.areas_for_improvement = [];
    result.improvements_list = [];
  }
  
  // Normalize feedback
  result.feedback_paragraph = result.draft_feedback || result.feedback_paragraph || "";
  result.draft_feedback = result.feedback_paragraph;
  
  // Normalize score based on mode
  if (mode === 'feedback_only') {
    result.score_suggestion = "N/A";
    result.total_score = null;
    result.max_score = null;
  } else {
    // Extract score from suggested_score object if present
    const suggestedScore = result.suggested_score as Record<string, unknown> | undefined;
    if (suggestedScore && typeof suggestedScore === 'object') {
      result.total_score = suggestedScore.earned_points;
      result.max_score = suggestedScore.possible_points;
      result.score_suggestion = suggestedScore.display || 
        `${suggestedScore.earned_points}/${suggestedScore.possible_points}`;
      result.score_percent = suggestedScore.percent;
    } else if (typeof result.total_score === 'number' && typeof result.max_score === 'number') {
      result.score_suggestion = `${result.total_score}/${result.max_score}`;
    } else if (result.qualitative_rating) {
      result.score_suggestion = result.qualitative_rating as string;
    } else {
      result.score_suggestion = "N/A";
    }
    
    // Build score derivation from rubric breakdown if available
    const breakdown = result.rubric_breakdown as Array<{
      criterion: string;
      earned_points: number;
      possible_points: number;
    }> | undefined;
    
    if (breakdown && Array.isArray(breakdown) && breakdown.length > 0) {
      const derivationParts = breakdown.map(b => 
        `${b.criterion}: ${b.earned_points}/${b.possible_points}`
      );
      result.score_derivation = derivationParts.join(', ');
    }
  }
  
  // Ensure teacher_notes exists
  if (!Array.isArray(result.teacher_notes)) {
    result.teacher_notes = [];
  }
  
  return result;
}
