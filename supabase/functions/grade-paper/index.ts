/**
 * =============================================================================
 * GRADE PAPER EDGE FUNCTION - BOTTOR ASSIST
 * =============================================================================
 * 
 * NEXT.JS MIGRATION: app/api/grade-paper/route.ts
 * 
 * PURPOSE: Grade student assignments using RUBRIC-FIRST methodology.
 * 
 * RUBRIC-FIRST GRADING:
 * - Uses teacher-provided rubric text OR rubric detected from documents
 * - If no rubric detected, switches to "Feedback-only" mode (no scoring)
 * - Never invents a grading system - grades strictly by provided criteria
 * 
 * GUARDRAILS:
 * - Do not penalize for "Source 1 missing" unless rubric explicitly requires labeled sources
 * - Grade by matching content to rubric requirements, not by assuming form labels
 * - If rubric says "3 sources," check whether THREE sources appear regardless of numbering
 * 
 * OUTPUT:
 * - Scoring mode: numeric score like "6.5/15" if rubric has point totals
 * - Feedback-only mode: score = "N/A", qualitative feedback only
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
  prompt_text?: string;
  assignment_doc_text?: string;  // Text from assignment/rubric documents
  grading_mode: 'scoring' | 'feedback-only';
  scoring_mode?: 'feedback-only' | 'auto-score' | 'rubric-based';  // New flexible scoring
  auto_score_settings?: {
    totalPoints: number | null;
    pointsPerQuestion: number | null;
    questionCount: number | null;
    partialCreditAllowed: boolean;
    usePointsPerQuestion: boolean;
  };
  content_type?: 'objective' | 'open-ended' | 'mixed';  // Smart fallback hint
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
      grading_mode = 'feedback-only',
      scoring_mode = 'feedback-only',
      auto_score_settings,
      content_type = 'mixed'
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

    console.log(`[grade-paper] Grading in ${scoring_mode} mode for ${grade_level} ${subject}, content_type: ${content_type}`);
    if (auto_score_settings) {
      console.log(`[grade-paper] Auto-score settings:`, JSON.stringify(auto_score_settings));
    }

    // Build the grading prompt based on mode and content type
    const prompt = buildGradingPrompt(body);
    const systemPrompt = buildSystemPrompt(scoring_mode, rubric, answer_key, content_type, auto_score_settings);

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
            content: systemPrompt,
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
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        gradingResult = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in response");
      }

      // Handle scoring vs feedback-only mode
      if (grading_mode === 'feedback-only') {
        gradingResult.score_suggestion = "N/A";
        gradingResult.total_score = null;
      } else {
        // Map to legacy format for UI compatibility
        if (typeof gradingResult.total_score === 'number' && gradingResult.max_score) {
          gradingResult.score_suggestion = `${gradingResult.total_score}/${gradingResult.max_score}`;
        } else if (typeof gradingResult.total_score === 'number') {
          gradingResult.score_suggestion = `${gradingResult.total_score}`;
        } else if (gradingResult.qualitative_rating) {
          gradingResult.score_suggestion = gradingResult.qualitative_rating;
        } else {
          gradingResult.score_suggestion = "N/A";
        }
      }

      // Ensure required fields exist
      if (!Array.isArray(gradingResult.strengths_list)) {
        gradingResult.strengths_list = [];
      }
      if (!Array.isArray(gradingResult.improvements_list)) {
        gradingResult.improvements_list = [];
      }
      if (!gradingResult.feedback_paragraph) {
        gradingResult.feedback_paragraph = "Please review this work and provide personalized feedback.";
      }

      // Map to legacy format
      gradingResult.strengths = gradingResult.strengths_list.join("\n• ") || "See detailed feedback";
      gradingResult.areas_for_improvement = gradingResult.improvements_list.join("\n• ") || "See detailed feedback";

    } catch (parseError) {
      console.error("[grade-paper] Failed to parse AI response:", parseError);
      gradingResult = {
        score_suggestion: grading_mode === 'feedback-only' ? "N/A" : "Unable to determine - please review manually",
        strengths: "Unable to parse AI response",
        areas_for_improvement: "Manual review required - AI parsing failed",
        feedback_paragraph: "Please review this work and provide personalized feedback.",
      };
    }

    console.log("[grade-paper] Grading complete, mode:", grading_mode, "score:", gradingResult.score_suggestion);

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
 * Build system prompt based on scoring mode with smart fallback behavior
 */
function buildSystemPrompt(
  scoringMode: 'feedback-only' | 'auto-score' | 'rubric-based', 
  rubric: string,
  answerKey?: string,
  contentType: 'objective' | 'open-ended' | 'mixed' = 'mixed',
  autoScoreSettings?: {
    totalPoints: number | null;
    pointsPerQuestion: number | null;
    questionCount: number | null;
    partialCreditAllowed: boolean;
    usePointsPerQuestion: boolean;
  }
): string {
  const basePrompt = `You are Bottor Assist, an AI grading assistant for teachers.

CRITICAL RULES - TEACHER-CONTROLLED GRADING:
1. Grade ONLY using the provided rubric/criteria or scoring rules - NEVER invent your own grading system
2. Grade ONLY what is present in the student work - do NOT invent or assume missing information
3. If handwriting is unclear or illegible, state "illegible/unclear" and do NOT guess
4. Match content to rubric requirements by substance, not by form labels
5. Do NOT penalize for "Source 1 missing" unless rubric explicitly requires labeled Source 1/2/3
6. If rubric says "3 sources," check if THREE sources appear in content (by titles/authors/etc) regardless of numbering
7. NEVER guess point values - only use values explicitly provided by the teacher

MULTI-DOCUMENT AWARENESS:
- Student work may come from multiple pages or documents
- Look for grading criteria embedded ANYWHERE in the uploaded materials
- Combine detected criteria across multiple pages/files into unified grading context
- Handle mixed-subject assignments (e.g., math workbook + ELA reading packet) by addressing each subject's content appropriately

SUBJECT-AGNOSTIC LOGIC:
- Do NOT rely on subject labels (math, ELA, etc.) for grading approach
- Determine grading strategy from the CONTENT itself
- All grading must be driven by: detected rubric, uploaded documents, or answer key (if provided)

GUARDRAILS:
- Never hallucinate content that isn't in the student work
- Keep educators in control - phrase all suggestions as recommendations
- Be specific and actionable in feedback
- Always explain HOW the score was derived`;

  // Handle auto-score mode
  if (scoringMode === 'auto-score' && autoScoreSettings) {
    const hasPointSettings = autoScoreSettings.usePointsPerQuestion 
      ? (autoScoreSettings.pointsPerQuestion !== null && autoScoreSettings.questionCount !== null)
      : (autoScoreSettings.totalPoints !== null);
    
    if (hasPointSettings) {
      const partialCreditNote = autoScoreSettings.partialCreditAllowed 
        ? '\n- Award partial credit when student shows correct reasoning or work, even if final answer is incorrect'
        : '\n- Do NOT award partial credit - answers are either fully correct or incorrect';
      
      const pointsExplanation = autoScoreSettings.usePointsPerQuestion
        ? `- Total points: ${(autoScoreSettings.pointsPerQuestion || 0) * (autoScoreSettings.questionCount || 0)} (${autoScoreSettings.pointsPerQuestion} points × ${autoScoreSettings.questionCount} questions)
- Award ${autoScoreSettings.pointsPerQuestion} points for each fully correct answer`
        : `- Total points possible: ${autoScoreSettings.totalPoints}
- Distribute points proportionally based on number of questions detected`;
      
      return `${basePrompt}

AUTO-SCORE MODE (Teacher-defined point rules):
Calculate a numeric score using ONLY these teacher-provided settings:
${pointsExplanation}${partialCreditNote}

SCORING PROCESS:
1. Identify each question/item in the student work
2. Compare to answer key (if provided) or evaluate correctness
3. Award points according to the rules above
4. Calculate total earned vs total possible
5. EXPLAIN how you arrived at the score

OUTPUT FORMAT (JSON only):
{
  "total_score": <number earned>,
  "max_score": ${autoScoreSettings.usePointsPerQuestion 
    ? (autoScoreSettings.pointsPerQuestion || 0) * (autoScoreSettings.questionCount || 0)
    : autoScoreSettings.totalPoints || 0},
  "score_suggestion": "<earned>/<max>",
  "score_derivation": "<brief explanation of how score was calculated, e.g., '8 of 10 correct at 2 pts each = 16/20'>",
  "per_question": [
    {
      "question": "<question number or identifier>",
      "correct": <true/false/partial>,
      "points_earned": <number>,
      "points_possible": <number>,
      "notes": "<what was correct/incorrect>"
    }
  ],
  "strengths_list": [
    "<bullet 1: what the student got right>",
    "<bullet 2: another strength>"
  ],
  "improvements_list": [
    "<bullet 1: specific item that was incorrect and correct answer>",
    "<bullet 2: another improvement>"
  ],
  "feedback_paragraph": "<A 3-5 sentence paragraph written directly to the student. Acknowledge what they got right, address errors constructively, encourage continued practice.>"
}`;
    }
  }

  // Handle rubric-based scoring
  if (scoringMode === 'rubric-based' && rubric?.trim()) {
    const hasPointValues = /\d+\s*(pts?|points?|\/\d+)/i.test(rubric);
    
    const contentGuidance = contentType === 'objective' 
      ? '\n- For objective questions (math, fill-in), verify correctness against any provided answer key'
      : contentType === 'open-ended'
      ? '\n- For open-ended responses (essays, analysis), evaluate depth, evidence, and reasoning per rubric criteria'
      : '\n- Handle mixed content by applying appropriate evaluation approach to each section';

    if (hasPointValues) {
      return `${basePrompt}

RUBRIC-BASED SCORING MODE (Numeric):
The rubric contains point values. Calculate a numeric score based strictly on the rubric.
- Award points ONLY for criteria that are met in the student work
- Use the exact point values from the rubric
- If rubric uses 0/0.5/1 scoring, follow that exactly
- Calculate total score as sum of all category scores${contentGuidance}

OUTPUT FORMAT (JSON only):
{
  "total_score": <number>,
  "max_score": <number from rubric>,
  "score_suggestion": "<total>/<max>",
  "score_derivation": "<brief explanation of how score was calculated from rubric categories>",
  "per_category": [
    {
      "category": "<rubric category name>",
      "points_earned": <number>,
      "points_possible": <number>,
      "notes": "<what was found or missing>"
    }
  ],
  "strengths_list": [
    "<bullet 1: strength tied to rubric category>",
    "<bullet 2: another strength>"
  ],
  "improvements_list": [
    "<bullet 1: specific actionable item tied to rubric>",
    "<bullet 2: another improvement>"
  ],
  "feedback_paragraph": "<A 3-5 sentence paragraph written directly to the student in warm, supportive teacher tone. Start with what they did well, address areas for growth, end with encouragement.>",
  "grading_notes": "<any notes about illegible text, missing sections, or grading considerations>"
}`;
    }

    // Rubric exists but no point values - qualitative assessment
    return `${basePrompt}

RUBRIC-BASED SCORING MODE (Qualitative):
The rubric has criteria but no specific point values. Provide qualitative rubric-aligned ratings.
- Evaluate each rubric criterion
- Use qualitative ratings like "Exceeds", "Meets", "Approaching", "Not Yet" for each
- Do NOT assign numeric scores since rubric doesn't specify points${contentGuidance}

OUTPUT FORMAT (JSON only):
{
  "score_suggestion": "N/A",
  "qualitative_rating": "<overall rating: Exceeds/Meets/Approaching/Not Yet>",
  "per_category": [
    {
      "category": "<rubric category name>",
      "rating": "<Exceeds/Meets/Approaching/Not Yet>",
      "notes": "<what was found or missing>"
    }
  ],
  "strengths_list": [
    "<bullet 1: strength tied to rubric category>",
    "<bullet 2: another strength>"
  ],
  "improvements_list": [
    "<bullet 1: specific actionable item tied to rubric>",
    "<bullet 2: another improvement>"
  ],
  "feedback_paragraph": "<A 3-5 sentence paragraph written directly to the student in warm, supportive teacher tone. Start with what they did well, address areas for growth, end with encouragement.>",
  "grading_notes": "<any notes about illegible text, missing sections, or grading considerations>"
}`;
  }

  // Feedback-only mode (default)
  // Check if we have an answer key that can help with objective content
  const hasAnswerKey = answerKey && answerKey.trim().length > 0;
  const isObjectiveContent = contentType === 'objective';
  
  if (hasAnswerKey && isObjectiveContent) {
    return `${basePrompt}

FEEDBACK-ONLY MODE (with Answer Key for Reference):
No scoring rules were provided, but an answer key is available for objective-style content.
- Use the answer key to evaluate correctness of responses
- Compare student answers to expected answers
- Do NOT assign a numeric score (no scoring rules provided)
- Provide accuracy-based feedback: which answers are correct, which need work
- Be specific about what the correct answer should be for incorrect items

OUTPUT FORMAT (JSON only):
{
  "score_suggestion": "N/A",
  "qualitative_rating": "<summary: e.g., '7 of 10 correct' or 'Mostly accurate'>",
  "strengths_list": [
    "<bullet 1: what the student answered correctly>",
    "<bullet 2: another strength>"
  ],
  "improvements_list": [
    "<bullet 1: specific item that was incorrect and what the right answer is>",
    "<bullet 2: another area for improvement>"
  ],
  "feedback_paragraph": "<A 3-5 sentence paragraph written directly to the student. Acknowledge what they got right, address errors constructively, encourage continued practice.>",
  "grading_notes": "<note explaining that no numeric score was calculated because no scoring rules were provided>"
}`;
  }
  
  return `${basePrompt}

FEEDBACK-ONLY MODE:
No rubric or scoring rules were provided. Provide qualitative feedback only.
- Do NOT assign any numeric score
- Focus on identifying what the student did well
- Provide constructive suggestions for improvement
- Do NOT guess what the rubric or point values might be
${contentType === 'open-ended' ? '- For open-ended responses, focus on clarity, organization, evidence use, and argument strength' : ''}

OUTPUT FORMAT (JSON only):
{
  "score_suggestion": "N/A",
  "qualitative_rating": null,
  "strengths_list": [
    "<bullet 1: what the student did well>",
    "<bullet 2: another strength>"
  ],
  "improvements_list": [
    "<bullet 1: specific actionable improvement>",
    "<bullet 2: another improvement>"
  ],
  "feedback_paragraph": "<A 3-5 sentence paragraph written directly to the student in warm, supportive teacher tone. Start with what they did well, address areas for growth, end with encouragement.>",
  "grading_notes": "<note explaining that no numeric score was calculated because no scoring rules were provided>"
}`;
}

/**
 * Build the grading prompt with all context
 */
function buildGradingPrompt(request: GradeRequest): string {
  const { 
    student_work, 
    grade_level, 
    subject, 
    assignment_type, 
    rubric, 
    answer_key, 
    prompt_text,
    assignment_doc_text,
    scoring_mode = 'feedback-only',
    auto_score_settings
  } = request;

  // Build scoring mode description
  let scoringModeDesc = 'Feedback-only (no numeric score)';
  if (scoring_mode === 'auto-score' && auto_score_settings) {
    if (auto_score_settings.usePointsPerQuestion) {
      scoringModeDesc = `Auto-score (${auto_score_settings.pointsPerQuestion} pts × ${auto_score_settings.questionCount} questions${auto_score_settings.partialCreditAllowed ? ', partial credit allowed' : ''})`;
    } else {
      scoringModeDesc = `Auto-score (${auto_score_settings.totalPoints} total points${auto_score_settings.partialCreditAllowed ? ', partial credit allowed' : ''})`;
    }
  } else if (scoring_mode === 'rubric-based') {
    scoringModeDesc = 'Rubric-based scoring';
  }

  const sections = [
    `## Assignment Context`,
    `- Grade Level: ${grade_level || "Not specified"}`,
    `- Subject: ${subject || "Not specified"}`,
    `- Assignment Type: ${assignment_type || "Not specified"}`,
    `- Scoring Mode: ${scoringModeDesc}`,
    "",
  ];

  // Include teacher's specific analysis prompt if provided
  if (prompt_text?.trim()) {
    sections.push(
      `## Teacher Prompt / Analysis Question`,
      prompt_text,
      ""
    );
  }

  // Include rubric if provided
  if (rubric?.trim()) {
    sections.push(
      `## Grading Rubric / Criteria`,
      `IMPORTANT: Grade STRICTLY using these criteria. Do not invent additional criteria.`,
      "",
      rubric,
      ""
    );
  }

  // Include assignment document text if provided
  if (assignment_doc_text?.trim()) {
    sections.push(
      `## Assignment / Rubric Document (extracted text)`,
      `Use this for context about the assignment and any grading criteria mentioned.`,
      "",
      assignment_doc_text,
      ""
    );
  }

  // Include answer key if provided
  if (answer_key?.trim()) {
    sections.push(
      `## Answer Key / Expected Responses`,
      answer_key,
      ""
    );
  }

  sections.push(
    `## Student Work`,
    ``,
    `INSTRUCTIONS:`,
    `- Evaluate ONLY what is present in the text below`,
    `- If you detect sections, headings, or labels, use them to understand structure`,
    `- Do NOT assume or invent content that is not present`,
    `- If text is illegible or unclear, note it and do not guess`,
    ``,
    `--- BEGIN STUDENT WORK ---`,
    student_work,
    `--- END STUDENT WORK ---`,
    ``,
    `Evaluate this work${rubric ? ' against the provided rubric' : ''}. Return JSON only.`
  );

  return sections.join("\n");
}
