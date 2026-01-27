/**
 * =============================================================================
 * GRADE PAPER EDGE FUNCTION - BOTTOR ASSIST
 * =============================================================================
 * 
 * MANDATORY NUMERIC SCORING:
 * - Always produces a numeric score (X/TOTAL) with percent
 * - Uses teacher-provided rubric if available
 * - Falls back to default 20-point rubric if none provided
 * 
 * GUARDRAILS:
 * - Be accurate, conservative, and transparent
 * - If confidence is low, flag for teacher review
 * =============================================================================
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

// Default rubric used when no rubric/scoring rules are detected
const DEFAULT_RUBRIC = {
  totalPoints: 20,
  criteria: [
    { name: "Accuracy / Correctness", points: 10, guidance: "Evaluate factual accuracy, correct answers, and sound reasoning" },
    { name: "Work Shown / Reasoning", points: 5, guidance: "Evaluate explanation of thought process, steps shown, and logical progression" },
    { name: "Completeness / Formatting", points: 5, guidance: "Evaluate whether all parts are addressed, proper format, and organization" }
  ]
};

interface RubricCriterion {
  name: string;
  points: number;
  guidance: string;
}

interface ParsedRubric {
  totalPoints: number;
  criteria: RubricCriterion[];
  source: 'teacher' | 'auto-generated';
}

interface GradeRequest {
  student_work: string;
  grade_level?: string;
  subject?: string;
  assignment_type?: string;
  rubric?: string;
  answer_key?: string;
  prompt_text?: string;
  assignment_doc_text?: string;
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

    // Parse or build rubric - ALWAYS get a rubric with points
    const parsedRubric = buildRubric({
      rubricText: rubric,
      answerKey: answer_key,
      quickRubricCategories: quick_rubric_categories,
      autoScoreSettings: auto_score_settings
    });

    console.log(`[grade-paper] Rubric source: ${parsedRubric.source}, Total points: ${parsedRubric.totalPoints}`);
    console.log(`[grade-paper] Criteria count: ${parsedRubric.criteria.length}`);
    console.log(`[grade-paper] Grade level: ${grade_level || 'unspecified'}, Subject: ${subject || 'unspecified'}`);
    console.log(`[grade-paper] Answer key provided: ${!!answer_key?.trim()}`);

    // Determine grading mode based on materials
    const hasRubric = parsedRubric.source === 'teacher';
    const hasAnswerKey = !!answer_key?.trim();
    const enhancedMode = hasRubric && hasAnswerKey;
    
    console.log(`[grade-paper] Enhanced mode (rubric + answer key): ${enhancedMode}`);

    // Build the prompt - always scoring mode now
    const { systemPrompt, userPrompt } = buildScoringPrompts({
      studentWork: student_work,
      subject,
      gradeLevel: grade_level,
      assignmentType: assignment_type,
      parsedRubric,
      answerKey: answer_key,
      assignmentDocText: assignment_doc_text,
      enhancedMode,
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

      // Normalize and validate the response
      gradingResult = normalizeGradingResult(gradingResult, parsedRubric);

    } catch (parseError) {
      console.error("[grade-paper] Failed to parse AI response:", parseError);
      // Fallback result with default scoring
      gradingResult = {
        mode: "scoring",
        rubric_source: parsedRubric.source,
        score_suggestion: `0/${parsedRubric.totalPoints}`,
        score_percent: 0,
        confidence: "low",
        strengths: ["Unable to parse AI response"],
        strengths_list: ["Unable to parse AI response"],
        areas_for_improvement: ["Manual review required - AI parsing failed"],
        improvements_list: ["Manual review required - AI parsing failed"],
        feedback_paragraph: "Please review this work and provide personalized feedback.",
        draft_feedback: "Please review this work and provide personalized feedback.",
        teacher_notes: ["AI response could not be parsed. Manual grading recommended."]
      };
    }

    console.log("[grade-paper] Grading complete, score:", gradingResult.score_suggestion);

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
 * Build or parse rubric from provided inputs
 * Falls back to default 20-point rubric if nothing usable is provided
 */
function buildRubric(params: {
  rubricText?: string;
  answerKey?: string;
  quickRubricCategories?: string;
  autoScoreSettings?: {
    totalPoints: number | null;
    pointsPerQuestion: number | null;
    questionCount: number | null;
    partialCreditAllowed: boolean;
    usePointsPerQuestion: boolean;
  };
}): ParsedRubric {
  const { rubricText, answerKey, quickRubricCategories, autoScoreSettings } = params;

  // Try to parse quick rubric categories first (most structured)
  if (quickRubricCategories?.trim()) {
    const parsed = parseQuickRubric(quickRubricCategories);
    if (parsed) return parsed;
  }

  // Try to extract points from rubric text BEFORE using auto-score settings
  // This prioritizes explicit "Total Points: X" patterns in the rubric
  if (rubricText?.trim()) {
    const parsed = parseRubricText(rubricText);
    if (parsed) {
      console.log(`[grade-paper] Using parsed rubric: ${parsed.totalPoints} total points`);
      return parsed;
    }
    // Rubric exists but couldn't parse points - check if frontend sent totalPoints
    console.log(`[grade-paper] Rubric text exists but couldn't parse points, checking auto-score settings`);
  }

  // Use auto-score settings (includes frontend-provided totalPoints)
  if (autoScoreSettings) {
    const parsed = parseAutoScoreSettings(autoScoreSettings);
    if (parsed) {
      // If we have rubric text, mark as teacher-provided even if using frontend totalPoints
      if (rubricText?.trim()) {
        console.log(`[grade-paper] Using frontend totalPoints (${parsed.totalPoints}) with teacher rubric text`);
        return { ...parsed, source: 'teacher' };
      }
      return parsed;
    }
  }

  // If we have an answer key but no rubric, use default rubric
  // The answer key will be used for correctness evaluation
  if (answerKey?.trim()) {
    console.log(`[grade-paper] Using default rubric with answer key`);
    return {
      ...DEFAULT_RUBRIC,
      source: 'auto-generated'
    };
  }

  // Fallback to default rubric
  console.log(`[grade-paper] Using default fallback rubric`);
  return {
    ...DEFAULT_RUBRIC,
    source: 'auto-generated'
  };
}

/**
 * Parse quick rubric format: "Category: X pts, Category2: Y pts"
 */
function parseQuickRubric(text: string): ParsedRubric | null {
  const parts = text.split(',').map(p => p.trim()).filter(Boolean);
  const criteria: RubricCriterion[] = [];
  let total = 0;

  for (const part of parts) {
    const match = part.match(/^(.+?):\s*(\d+)\s*(?:pts?|points?)?$/i);
    if (match) {
      const points = parseInt(match[2], 10);
      criteria.push({
        name: match[1].trim(),
        points,
        guidance: `Evaluate ${match[1].trim().toLowerCase()}`
      });
      total += points;
    }
  }

  if (criteria.length > 0 && total > 0) {
    return { totalPoints: total, criteria, source: 'teacher' };
  }
  return null;
}

/**
 * Parse auto-score settings into rubric format
 */
function parseAutoScoreSettings(settings: {
  totalPoints: number | null;
  pointsPerQuestion: number | null;
  questionCount: number | null;
  partialCreditAllowed: boolean;
  usePointsPerQuestion: boolean;
}): ParsedRubric | null {
  if (settings.usePointsPerQuestion && settings.pointsPerQuestion && settings.questionCount) {
    const total = settings.pointsPerQuestion * settings.questionCount;
    return {
      totalPoints: total,
      criteria: [{
        name: "Question Correctness",
        points: total,
        guidance: `${settings.questionCount} questions at ${settings.pointsPerQuestion} points each. ${settings.partialCreditAllowed ? 'Partial credit allowed.' : ''}`
      }],
      source: 'teacher'
    };
  }

  if (settings.totalPoints) {
    return {
      totalPoints: settings.totalPoints,
      criteria: [{
        name: "Overall Score",
        points: settings.totalPoints,
        guidance: "Evaluate overall quality and correctness"
      }],
      source: 'teacher'
    };
  }

  return null;
}

/**
 * Attempt to parse point values from rubric text
 * Uses STRICT priority: explicit total > sum of criteria > fallback
 * Returns null if no clear point structure is found
 */
function parseRubricText(text: string): ParsedRubric | null {
  let explicitTotal: number | null = null;

  // (A) PRIORITY: Look for EXPLICIT total patterns FIRST
  // These are the most authoritative and should NEVER be guessed
  const explicitTotalPatterns = [
    // "Total Points: 20" or "Total Points = 20" - HIGHEST priority
    /total\s*points?\s*[:=]\s*(\d+)/i,
    // "Total: 20 points" or "Total: 20 pts"
    /total\s*[:=]\s*(\d+)\s*(?:pts?|points?)/i,
    // "(20 points total)" or "20 points total"
    /(\d+)\s*(?:pts?|points?)\s*total/i,
    // "out of 20" at end of line or "/20 points"
    /(?:out of|\/)\s*(\d+)\s*(?:pts?|points?)?(?:\s|$|\.)/i,
    // "Maximum: 20 points" or "Max Score: 20"
    /max(?:imum)?\s*(?:score|points?)?\s*[:=]?\s*(\d+)/i,
    // "__/20" scoring format often in rubrics
    /__\/(\d+)/,
  ];

  for (const pattern of explicitTotalPatterns) {
    const match = text.match(pattern);
    if (match) {
      const val = parseInt(match[1], 10);
      if (val > 0 && val <= 1000) {
        explicitTotal = val;
        console.log(`[grade-paper] Detected explicit total: ${val} from pattern: ${pattern}`);
        break;
      }
    }
  }

  // (B) Parse individual criteria/items with points
  const categoryPattern = /([A-Za-z][A-Za-z\s\/]+?)(?::|[\(\[])\s*(\d+)\s*(?:pts?|points?)?(?:[\)\]])?/g;
  const criteria: RubricCriterion[] = [];
  let match;
  
  while ((match = categoryPattern.exec(text)) !== null) {
    const name = match[1].trim();
    const points = parseInt(match[2], 10);
    
    // Filter out obvious non-criteria matches
    const lowerName = name.toLowerCase();
    const isExcluded = ['total', 'maximum', 'max', 'out of', 'score'].some(
      ex => lowerName === ex || lowerName.startsWith(ex + ' ')
    );
    
    if (!isExcluded && name.length > 2 && name.length < 50 && points > 0 && points <= 100) {
      criteria.push({
        name,
        points,
        guidance: `Teacher rubric criterion: ${name}`
      });
    }
  }

  // If we found an explicit total, use it (highest priority)
  if (explicitTotal) {
    return {
      totalPoints: explicitTotal,
      criteria: criteria.length > 0 ? criteria : [{
        name: "Overall Assessment",
        points: explicitTotal,
        guidance: "Evaluate based on teacher's rubric criteria in the text"
      }],
      source: 'teacher'
    };
  }

  // If we found criteria, sum them for total
  if (criteria.length > 0) {
    const total = criteria.reduce((sum, c) => sum + c.points, 0);
    return { totalPoints: total, criteria, source: 'teacher' };
  }

  // Check for presence of rubric keywords without parseable points
  const hasRubricKeywords = /rubric|criteria|grading|scoring|points/i.test(text);
  if (hasRubricKeywords) {
    // Rubric text exists but couldn't parse points - return null to force manual input
    console.log(`[grade-paper] Rubric keywords found but no points could be parsed`);
    return null;
  }

  return null;
}

/**
 * Build scoring prompts - always produces numeric score
 * Enhanced mode when both rubric AND answer key are present
 */
function buildScoringPrompts(params: {
  studentWork: string;
  subject?: string;
  gradeLevel?: string;
  assignmentType?: string;
  parsedRubric: ParsedRubric;
  answerKey?: string;
  assignmentDocText?: string;
  enhancedMode?: boolean;
}): { systemPrompt: string; userPrompt: string } {

  const rubricText = params.parsedRubric.criteria.map(c => 
    `- ${c.name}: ${c.points} points (${c.guidance})`
  ).join('\n');

  const isAutoGenerated = params.parsedRubric.source === 'auto-generated';
  const hasAnswerKey = !!params.answerKey?.trim();
  const enhancedMode = params.enhancedMode || false;

  // Build enhanced system prompt when both rubric and answer key are present
  const systemPrompt = `You are Bottor Assist, a teacher-facing grading assistant. You must be accurate, conservative, and transparent.

MANDATORY RULES:
1. ALWAYS produce a numeric score out of ${params.parsedRubric.totalPoints} points.
2. Score must be calculated by summing points from each rubric criterion.
3. ${isAutoGenerated 
    ? 'Rubric is auto-generated (default template). Be transparent about this in teacher_notes.' 
    : 'Rubric is teacher-provided and LOCKED for scoring. Follow it exactly as the single source of truth.'}
${hasAnswerKey ? `4. ANSWER KEY PROVIDED: Use it to validate correctness for each question/item.
   - Compare student responses against the answer key exactly
   - Award full credit only when the answer matches (allowing for equivalent expressions)
   - Detect partial credit opportunities when student shows correct process but wrong final answer
   - Resolve ambiguous responses by referencing the answer key` : ''}
${enhancedMode ? `5. ENHANCED MODE ACTIVE: Both rubric AND answer key are present.
   - Use the RUBRIC for scoring structure (criteria and point allocations)
   - Use the ANSWER KEY as the correctness reference
   - Cross-validate: ensure rubric scores align with answer key correctness
   - This provides the highest grading accuracy` : ''}
6. If something is unclear or illegible, award 0 points for that criterion and note it.
7. Include a confidence level: "high" if grading is straightforward, "medium" if some interpretation needed, "low" if significant uncertainty.
8. Be consistent: total earned points must equal the sum of criterion scores.
9. Never contradict yourself between the breakdown and narrative feedback.
10. FAILSAFE: If rubric exists but points cannot be determined, infer total from structure. NEVER fall back to feedback-only mode while a rubric exists.`;

  const userPrompt = `Teacher context:
Subject: ${params.subject || "Not provided"}
Grade level: ${params.gradeLevel || "Not provided"}
Assignment type: ${params.assignmentType || "Not provided"}

RUBRIC (${isAutoGenerated ? 'Auto-Generated - Default Template' : 'Teacher-Provided — LOCKED FOR SCORING'}):
Total Points: ${params.parsedRubric.totalPoints}
Criteria:
${rubricText}

${params.answerKey ? `ANSWER KEY (Use for correctness validation):
${params.answerKey}
` : ''}
${params.assignmentDocText ? `ASSIGNMENT CONTEXT:
${params.assignmentDocText}
` : ''}
STUDENT WORK:
${params.studentWork}

TASK:
Grade this student work using the rubric above. You MUST:
1. Evaluate each criterion and award points based on evidence in the student work
${hasAnswerKey ? '2. Cross-reference answers against the ANSWER KEY for correctness validation' : '2. Evaluate based on rubric criteria and student reasoning'}
3. Calculate total earned points (sum of all criterion scores)
4. Calculate percent = (earned / ${params.parsedRubric.totalPoints}) × 100, rounded to whole number
5. Determine confidence level based on clarity of student work and rubric alignment

OUTPUT FORMAT (STRICT JSON):
{
  "mode": "scoring",
  "rubric_source": "${params.parsedRubric.source}",
  "grading_mode": "${enhancedMode ? 'enhanced' : hasAnswerKey ? 'answer_key_assisted' : 'rubric_only'}",
  "suggested_score": {
    "earned_points": <number>,
    "possible_points": ${params.parsedRubric.totalPoints},
    "display": "<earned>/${params.parsedRubric.totalPoints}",
    "percent": <number 0-100>,
    "letter_grade": "<A/B/C/D/F based on percent>"
  },
  "confidence": "<high|medium|low>",
  "rubric_breakdown": [
    {
      "criterion": "<criterion name>",
      "possible_points": <number>,
      "earned_points": <number>,
      "evidence": "<1-2 sentences citing specific evidence from student work>"
    }
  ],
  "strengths": ["<3-6 bullets>"],
  "areas_for_improvement": ["<3-6 bullets>"],
  "draft_feedback": "<1 paragraph written to the student>",
  "teacher_notes": ["<1-3 bullets about grading decisions, unclear areas, or recommendations>"]
}`;

  return { systemPrompt, userPrompt };
}

/**
 * Normalize and validate grading result
 */
function normalizeGradingResult(
  result: Record<string, unknown>,
  rubric: ParsedRubric
): Record<string, unknown> {
  
  result.mode = "scoring";
  result.rubric_source = result.rubric_source || rubric.source;

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

  // Extract and validate score
  const suggestedScore = result.suggested_score as Record<string, unknown> | undefined;
  if (suggestedScore && typeof suggestedScore === 'object') {
    const earned = Number(suggestedScore.earned_points) || 0;
    const possible = rubric.totalPoints;
    const percent = Math.round((earned / possible) * 100);
    
    result.total_score = earned;
    result.max_score = possible;
    result.score_suggestion = `${earned}/${possible}`;
    result.score_percent = percent;
    result.letter_grade = suggestedScore.letter_grade || getLetterGrade(percent);
    result.confidence = result.confidence || "medium";
  } else {
    // No valid score structure - use defaults
    result.total_score = 0;
    result.max_score = rubric.totalPoints;
    result.score_suggestion = `0/${rubric.totalPoints}`;
    result.score_percent = 0;
    result.letter_grade = "F";
    result.confidence = "low";
  }

  // Build score derivation from rubric breakdown
  const breakdown = result.rubric_breakdown as Array<{
    criterion: string;
    earned_points: number;
    possible_points: number;
  }> | undefined;

  if (breakdown && Array.isArray(breakdown) && breakdown.length > 0) {
    const derivationParts = breakdown.map(b =>
      `${b.criterion}: ${b.earned_points}/${b.possible_points}`
    );
    result.score_derivation = derivationParts.join(' | ');
  }

  // Ensure teacher_notes exists
  if (!Array.isArray(result.teacher_notes)) {
    result.teacher_notes = [];
  }

  // Add auto-generated rubric note if applicable
  if (rubric.source === 'auto-generated' && Array.isArray(result.teacher_notes)) {
    const hasNote = (result.teacher_notes as string[]).some(n => 
      n.toLowerCase().includes('auto-generated') || n.toLowerCase().includes('default')
    );
    if (!hasNote) {
      (result.teacher_notes as string[]).unshift(
        "Scored using Bottor's default 20-point template (no rubric detected). Consider providing a rubric for more precise scoring."
      );
    }
  }

  return result;
}

/**
 * Convert percent to letter grade
 */
function getLetterGrade(percent: number): string {
  if (percent >= 90) return "A";
  if (percent >= 80) return "B";
  if (percent >= 70) return "C";
  if (percent >= 60) return "D";
  return "F";
}
