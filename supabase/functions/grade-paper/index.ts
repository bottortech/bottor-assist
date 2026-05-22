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
import {
  parseRubricCriteria as sharedParseRubric,
  normalizeToPoints as sharedNormalize,
  formatParsedRubricForGrading as sharedFormatRubric,
} from "../_shared/rubricParser.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

// Default rubric used when no rubric/scoring rules are detected
const DEFAULT_RUBRIC = {
  totalPoints: 20,
  criteria: [
    {
      name: "Accuracy / Correctness",
      points: 10,
      guidance: "Evaluate factual accuracy, correct answers, and sound reasoning",
    },
    {
      name: "Work Shown / Reasoning",
      points: 5,
      guidance: "Evaluate explanation of thought process, steps shown, and logical progression",
    },
    {
      name: "Completeness / Formatting",
      points: 5,
      guidance: "Evaluate whether all parts are addressed, proper format, and organization",
    },
  ],
};

interface RubricCriterion {
  name: string;
  points: number;
  guidance: string;
}

interface ParsedRubric {
  totalPoints: number;
  criteria: RubricCriterion[];
  source: "teacher" | "auto-generated";
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
  grading_mode?: "scoring" | "feedback-only";
  scoring_mode?: "feedback-only" | "auto-score" | "rubric-based";
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
      quick_rubric_categories,
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

    // Parse or build rubric - ALWAYS get a rubric with points
    const parsedRubric = buildRubric({
      rubricText: rubric,
      answerKey: answer_key,
      quickRubricCategories: quick_rubric_categories,
      autoScoreSettings: auto_score_settings,
    });

    console.log(`[grade-paper] Rubric source: ${parsedRubric.source}, Total points: ${parsedRubric.totalPoints}`);
    console.log(`[grade-paper] Criteria count: ${parsedRubric.criteria.length}`);
    console.log(`[grade-paper] Grade level: ${grade_level || "unspecified"}, Subject: ${subject || "unspecified"}`);
    console.log(`[grade-paper] Answer key provided: ${!!answer_key?.trim()}`);

    // Determine grading mode based on materials
    const hasRubric = parsedRubric.source === "teacher";
    const hasAnswerKey = !!answer_key?.trim();
    const enhancedMode = hasRubric && hasAnswerKey;

    console.log(`[grade-paper] Enhanced mode (rubric + answer key): ${enhancedMode}`);

    // Build the prompt - always scoring mode now
    // Pass raw rubric text for work requirement detection
    const { systemPrompt, userPrompt } = buildScoringPrompts({
      studentWork: student_work,
      subject,
      gradeLevel: grade_level,
      assignmentType: assignment_type,
      parsedRubric,
      answerKey: answer_key,
      assignmentDocText: assignment_doc_text,
      enhancedMode,
      rubricRawText: rubric, // Pass original rubric for work requirement analysis
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

      // FORCE CORRECT PERFORMANCE LEVEL MAPPING (defensive fix)
      // If we detect a weighted 100-point rubric with 4-level performance descriptors,
      // enforce: 4=100%, 3=75%, 2=50%, 1=25% for each category weight.
      gradingResult = forceCorrectPerformanceLevelMapping(gradingResult, parsedRubric, rubric);

      // RUBRIC FIDELITY: strip any criterion in the AI response whose name
      // doesn't appear in the teacher-provided rubric. Then re-sync totals.
      gradingResult = enforceCriterionWhitelist(gradingResult, parsedRubric);

      // SELF-CONSISTENCY: detect full-marks-with-improvement contradictions
      // and auto-deduct 1 point on the affected criterion.
      gradingResult = runConsistencyCheckOnResult(gradingResult, parsedRubric);
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
        teacher_notes: ["AI response could not be parsed. Manual grading recommended."],
        consistency_check: { passed: true, adjustments: [] },
      };
    }


    console.log("[grade-paper] Grading complete, score:", gradingResult.score_suggestion);

    return new Response(JSON.stringify(gradingResult), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[grade-paper] Error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
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
        return { ...parsed, source: "teacher" };
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
      source: "auto-generated",
    };
  }

  // Fallback to default rubric
  console.log(`[grade-paper] Using default fallback rubric`);
  return {
    ...DEFAULT_RUBRIC,
    source: "auto-generated",
  };
}

/**
 * Parse quick rubric format: "Category: X pts, Category2: Y pts"
 */
function parseQuickRubric(text: string): ParsedRubric | null {
  const parts = text
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const criteria: RubricCriterion[] = [];
  let total = 0;

  for (const part of parts) {
    const match = part.match(/^(.+?):\s*(\d+)\s*(?:pts?|points?)?$/i);
    if (match) {
      const points = parseInt(match[2], 10);
      criteria.push({
        name: match[1].trim(),
        points,
        guidance: `Evaluate ${match[1].trim().toLowerCase()}`,
      });
      total += points;
    }
  }

  if (criteria.length > 0 && total > 0) {
    return { totalPoints: total, criteria, source: "teacher" };
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
      criteria: [
        {
          name: "Question Correctness",
          points: total,
          guidance: `${settings.questionCount} questions at ${settings.pointsPerQuestion} points each. ${settings.partialCreditAllowed ? "Partial credit allowed." : ""}`,
        },
      ],
      source: "teacher",
    };
  }

  if (settings.totalPoints) {
    return {
      totalPoints: settings.totalPoints,
      criteria: [
        {
          name: "Overall Score",
          points: settings.totalPoints,
          guidance: "Evaluate overall quality and correctness",
        },
      ],
      source: "teacher",
    };
  }

  return null;
}

/**
 * Adapter around the canonical shared rubric parser.
 * Returns this function's internal `ParsedRubric` shape (criterion.guidance).
 *
 * NOTE: The single source of truth is `supabase/functions/_shared/rubricParser.ts`.
 * Do not re-introduce a bespoke parser here.
 */
function parseRubricText(text: string): ParsedRubric | null {
  if (!text?.trim()) return null;

  const parsed = sharedNormalize(sharedParseRubric(text));
  if (parsed.status !== "valid" || parsed.criteria.length === 0) {
    return null;
  }

  const scoring = parsed.criteria.filter((c) => !c.isBonus);
  if (scoring.length === 0) return null;

  const criteria: RubricCriterion[] = scoring.map((c) => ({
    name: c.name,
    points: c.points ?? 0,
    guidance: c.description || `Teacher rubric criterion: ${c.name}`,
  }));

  const total =
    parsed.totalPoints ?? criteria.reduce((s, c) => s + c.points, 0);

  console.log(
    `[grade-paper] Parsed ${criteria.length} criteria via shared parser, total: ${total} (${parsed.totalSource})`,
  );

  return {
    totalPoints: total,
    criteria,
    source: "teacher",
  };
}

  return null;
}

/**
 * Analyze rubric text to determine if "show your work" is required
 * Returns true ONLY if the rubric explicitly mentions work/steps/process requirements
 */
function doesRubricRequireWork(rubricText?: string, parsedRubric?: ParsedRubric): boolean {
  if (!rubricText && !parsedRubric) return false;
  
  const textToAnalyze = rubricText || "";
  const criteriaNames = parsedRubric?.criteria?.map(c => c.name.toLowerCase()).join(" ") || "";
  const combinedText = (textToAnalyze + " " + criteriaNames).toLowerCase();
  
  // Explicit indicators that work is REQUIRED
  const workRequiredPatterns = [
    /show\s*(?:your|the|all)?\s*work/i,           // "show your work", "show work"
    /work\s*(?:must\s*be\s*)?shown/i,             // "work shown", "work must be shown"
    /steps?\s*(?:must\s*be\s*)?shown/i,           // "steps shown", "steps must be shown"
    /solving\s*steps?\s*(?:shown)?/i,             // "solving steps", "solving steps shown"
    /correct\s*(?:equation\s*)?setup/i,           // "correct setup", "correct equation setup"
    /no\s*(?:credit|points?)\s*(?:without|for\s*no)\s*work/i,  // "no credit without work"
    /(?:partial|full)\s*credit\s*(?:for|requires?)\s*(?:process|steps|work)/i,
    /work\s*(?:for|worth|valued?\s*at)\s*\d+\s*(?:pts?|points?)/i,  // "work: X points", "work for 2 pts"
    /(?:correct|accurate)\s*process/i,            // "correct process"
    /(?:equation|problem)\s*setup\s*[:=\-–]\s*\d+/i,  // "equation setup: 2 points"
    /no\s*work\s*(?:=|:|\-|–)?\s*(?:max(?:imum)?|only|partial)/i,  // "no work = maximum 3 points"
    /(?:max(?:imum)?|only)\s*\d+\s*(?:pts?|points?)?\s*(?:for|with|if)\s*no\s*work/i,
    /work\s*shown\s*[:=\-–]\s*\d+/i,              // "work shown: 2 points"
    /process\s*[:=\-–]\s*\d+\s*(?:pts?|points?)/i,  // "process: 10 points"
  ];
  
  for (const pattern of workRequiredPatterns) {
    if (pattern.test(combinedText)) {
      console.log(`[grade-paper] Work requirement detected via pattern: ${pattern}`);
      return true;
    }
  }
  
  // Check criteria names for work-related scoring
  const workCriteriaNames = [
    /work\s*shown/i,
    /solving\s*steps/i,
    /equation\s*setup/i,
    /problem\s*setup/i,
    /process/i,
    /methodology/i,
  ];
  
  for (const criterion of parsedRubric?.criteria || []) {
    for (const namePattern of workCriteriaNames) {
      if (namePattern.test(criterion.name)) {
        console.log(`[grade-paper] Work requirement detected in criterion: ${criterion.name}`);
        return true;
      }
    }
  }
  
  console.log(`[grade-paper] No work requirement detected in rubric - using answer-only mode`);
  return false;
}

/**
 * Build scoring prompts - always produces numeric score
 * Enhanced mode when both rubric AND answer key are present
 * NOW RUBRIC-AWARE for "show your work" requirements
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
  rubricRawText?: string; // Original rubric text for work requirement detection
}): { systemPrompt: string; userPrompt: string } {
  // Serialize via the shared formatter when we have raw teacher rubric text
  // so the model sees the canonical points-only format (incl. bonus block).
  // Fall back to internal criteria list (auto-generated / quick-rubric / answer-key paths).
  const isTeacherRubric = params.parsedRubric.source === "teacher";
  let rubricText: string;
  if (isTeacherRubric && params.rubricRawText?.trim()) {
    const sharedFormatted = sharedFormatRubric(sharedParseRubric(params.rubricRawText));
    rubricText = sharedFormatted || params.parsedRubric.criteria
      .map((c) => `- ${c.name}: ${c.points} points (${c.guidance})`)
      .join("\n");
  } else {
    rubricText = params.parsedRubric.criteria
      .map((c) => `- ${c.name}: ${c.points} points (${c.guidance})`)
      .join("\n");
  }
  console.log(`[grade-paper] Serialized rubric for model:\n${rubricText}`);

  const isAutoGenerated = params.parsedRubric.source === "auto-generated";
  const hasAnswerKey = !!params.answerKey?.trim();
  const enhancedMode = params.enhancedMode || false;

  // Detect if this is a 100-point weighted rubric
  const is100PointScale = params.parsedRubric.totalPoints === 100;

  // Detect if this is a math assignment (look for math-related keywords)
  const isMathAssignment = /math|algebra|equation|solve|variable|linear|calculation/i.test(
    (params.subject || "") + (params.assignmentType || "") + (params.studentWork || "")
  );

  // KEY CHANGE: Check if rubric EXPLICITLY requires showing work
  const rubricRequiresWork = doesRubricRequireWork(params.rubricRawText, params.parsedRubric);
  const shouldEnforceWorkShown = isMathAssignment && rubricRequiresWork;
  
  console.log(`[grade-paper] Math assignment: ${isMathAssignment}, Rubric requires work: ${rubricRequiresWork}, Enforcing work shown: ${shouldEnforceWorkShown}`);

  // Build enhanced system prompt when both rubric and answer key are present
  const systemPrompt = `You are Bottor Assist, a teacher-facing grading assistant. You must be accurate, conservative, and transparent.

MANDATORY RULES:
1. ALWAYS produce a numeric score out of ${params.parsedRubric.totalPoints} points.
2. Score must be calculated by summing points from each rubric criterion.
3. ${
    isAutoGenerated
      ? "Rubric is auto-generated (default template). Be transparent about this in teacher_notes."
      : "Rubric is teacher-provided and LOCKED for scoring. Follow it exactly as the single source of truth."
  }

RUBRIC FIDELITY GUARDRAILS (MANDATORY):
- Use ONLY the criteria provided in the rubric below. Do not invent, substitute, or supplement criteria from any default framework, even if you believe additional criteria would be relevant.
- If the rubric has N criteria, your "rubric_breakdown" array MUST contain EXACTLY N entries with names that match the rubric criteria character-for-character.
- Score each criterion INDEPENDENTLY based only on evidence relevant to that criterion. Do not adjust scores to match an overall impression of the work.
- A criterion may only receive FULL POINTS (e.g., 25/25) if there are ZERO weaknesses, errors, or improvement notes related to that criterion anywhere in your response (including areas_for_improvement and teacher_notes). Before returning, verify this consistency — if a criterion has full marks but you also flagged a related issue, reduce its score.

${
  hasAnswerKey
    ? `4. ANSWER KEY PROVIDED: Use it to validate correctness for each question/item.
   - Compare student responses against the answer key exactly
   - Award full credit only when the answer matches (allowing for equivalent expressions)
   - Detect partial credit opportunities when student shows correct process but wrong final answer
   - Resolve ambiguous responses by referencing the answer key`
    : ""
}
${
  enhancedMode
    ? `5. ENHANCED MODE ACTIVE: Both rubric AND answer key are present.
   - Use the RUBRIC for scoring structure (criteria and point allocations)
   - Use the ANSWER KEY as the correctness reference
   - Cross-validate: ensure rubric scores align with answer key correctness
   - This provides the highest grading accuracy`
    : ""
}

CRITICAL: PERFORMANCE LEVELS vs CATEGORY WEIGHTS
- If a rubric has explicit CATEGORY POINT VALUES (e.g., "Accuracy – 40 points", "Work Shown – 30 points"), these are the actual point allocations. Do NOT normalize to a 5-point scale.
- If a rubric has PERFORMANCE LEVELS (e.g., "4 = Excellent, 3 = Proficient, 2 = Developing, 1 = Beginning"), these are DESCRIPTORS, not raw point values.

MANDATORY PERFORMANCE LEVEL TO PERCENTAGE MAPPING:
When a rubric uses 4-level performance descriptors with weighted categories, you MUST use this exact mapping:
- Level 4 (Excellent/Exemplary) = 100% of category weight
- Level 3 (Proficient/Competent) = 75% of category weight
- Level 2 (Developing/Basic) = 50% of category weight
- Level 1 (Beginning/Needs Work) = 25% of category weight

SCORING FORMULA: earned_points = ROUND(category_weight × percentage)

EXAMPLES (you must follow these exactly):
- Accuracy 40 pts + Proficient (Level 3) → 40 × 0.75 = 30 points
- Problem Solving 20 pts + Proficient (Level 3) → 20 × 0.75 = 15 points
- Work Shown 30 pts + Excellent (Level 4) → 30 × 1.00 = 30 points
- Completion 10 pts + Developing (Level 2) → 10 × 0.50 = 5 points

CRITICAL: Never use 60% for Proficient (Level 3). Never use 80% for Proficient. Always use exactly 75% for Proficient.

TEST CASE TO VERIFY:
For a 100-point rubric with Accuracy=40pts, Work Shown=30pts, Problem Solving=20pts, Completion=10pts:
If student gets: Proficient, Excellent, Proficient, Excellent
Expected output: 30/40, 30/30, 15/20, 10/10 = 85/100 total
${is100PointScale ? `- This rubric uses a 100-point scale. Output the final score out of 100 points.` : ""}

${shouldEnforceWorkShown ? `
===== CRITICAL: RUBRIC REQUIRES "SHOW YOUR WORK" - ENFORCING =====
GRADING MODE: WORK-REQUIRED GRADING

The teacher's rubric EXPLICITLY requires students to show their work/steps/process.
You MUST check for visible work and apply penalties when work is missing.

For EACH math problem, you MUST perform a two-step analysis:

STEP A: VISUAL EVIDENCE CHECK
Look at the student's work and determine:
- Is there ANY visible work/steps written between the problem and the final answer?
- Or is there ONLY a final answer with no intermediate steps?

What counts as "work shown":
✓ Arithmetic operations written out (e.g., "15 - 8 = 7")
✓ Intermediate steps (e.g., "2m + 5 = 17" → "2m = 12" → "m = 6")
✓ Equations written for word problems (e.g., "x - 12 = 23")
✓ Division/multiplication steps shown (e.g., "2m/2 = 12/2")
✓ Verbal descriptions of steps (e.g., "subtract 5 from both sides")
✓ Cross-outs showing trial and error (shows thinking process)

What does NOT count as "work shown":
✗ Only the final answer written (e.g., just "x = 7" with nothing else)
✗ Only the variable and answer (e.g., just "λ = 7" below the problem)
✗ Answer written in the answer blank with no steps
✗ Circling or underlining the final answer (without showing how they got it)

STEP B: APPLY RUBRIC-BASED SCORING PER QUESTION

Follow the EXACT point breakdown from the rubric. If the rubric says:
- "Correct equation setup: 2 points" → Award 2 points ONLY if setup is visible
- "Correct solving steps shown: 2 points" → Award ONLY if steps are visible
- "Correct final answer: 1 point" → Award if answer is correct

IF work is NOT shown but answer is correct:
- Award 0 points for "setup" and "steps shown" criteria (no evidence visible)
- Award full points for "correct answer" criterion
- Apply any partial credit rules from rubric (e.g., "max 3/5 for correct answer, no work")
- MAXIMUM: Follow rubric's explicit "no work shown" penalty (typically 60% of question value)

WORD PROBLEMS REQUIRE EQUATION:
- Word problems need a written equation to get full credit for "setup" criterion
- Just writing the numerical answer earns only "correct answer" points
- Example: "Sarah started with $35" without "x - 12 = 23" = only 1/5 (answer point only)

INCLUDE IN FEEDBACK:
- When work is missing, state: "Remember to show your work on problems [X, Y]. The rubric requires visible solving steps for full credit."

===== END RUBRIC-AWARE WORK ENFORCEMENT =====
` : isMathAssignment ? `
===== GRADING MODE: ANSWER-ONLY (Rubric does NOT require showing work) =====

This rubric does NOT explicitly require students to show their work.
Grade based on ANSWER CORRECTNESS only.

For each problem:
1. Check if the final answer is correct
2. Award full points if correct, zero/partial if incorrect
3. DO NOT penalize for missing work (rubric doesn't require it)
4. DO NOT mention "show your work" in feedback (not relevant to this rubric)

Focus feedback on: answer accuracy, conceptual understanding, common mistakes to avoid.

===== END ANSWER-ONLY MODE =====
` : ""}

6. If something is unclear or illegible, award 0 points for that criterion and note it.
7. Include a confidence level: "high" if grading is straightforward, "medium" if some interpretation needed, "low" if significant uncertainty.
8. Be consistent: total earned points must equal the sum of criterion scores.
9. Never contradict yourself between the breakdown and narrative feedback.
10. FAILSAFE: If rubric exists but points cannot be determined, infer total from structure. NEVER fall back to feedback-only mode while a rubric exists.`;

  const userPrompt = `Teacher context:
Subject: ${params.subject || "Not provided"}
Grade level: ${params.gradeLevel || "Not provided"}
Assignment type: ${params.assignmentType || "Not provided"}

RUBRIC (${isAutoGenerated ? "Auto-Generated - Default Template" : "Teacher-Provided — LOCKED FOR SCORING"}):
Total Points: ${params.parsedRubric.totalPoints}
Criteria:
${rubricText}
${shouldEnforceWorkShown ? `
⚠️ WORK REQUIREMENT DETECTED: This rubric requires students to show their work.
Apply "no work shown" penalties as specified in the rubric.` : isMathAssignment ? `
ℹ️ ANSWER-ONLY MODE: This rubric does NOT require showing work.
Grade based on answer correctness only.` : ""}

${
  params.answerKey
    ? `ANSWER KEY (Use for correctness validation):
${params.answerKey}
`
    : ""
}
${
  params.assignmentDocText
    ? `ASSIGNMENT CONTEXT:
${params.assignmentDocText}
`
    : ""
}
STUDENT WORK:
${params.studentWork}

TASK:
Grade this student work using the rubric above. You MUST:
1. Evaluate each criterion and award points based on evidence in the student work
${hasAnswerKey ? "2. Cross-reference answers against the ANSWER KEY for correctness validation" : "2. Evaluate based on rubric criteria and student reasoning"}
3. Calculate total earned points (sum of all criterion scores)
4. Calculate percent = (earned / ${params.parsedRubric.totalPoints}) × 100, rounded to whole number
5. Determine confidence level based on clarity of student work and rubric alignment
${shouldEnforceWorkShown ? `6. FOR EACH MATH QUESTION: Check if work is shown. If no work visible but answer correct, apply rubric's "no work" penalty (typically max 60% of question points)` : ""}

OUTPUT FORMAT (STRICT JSON):
{
  "mode": "scoring",
  "rubric_source": "${params.parsedRubric.source}",
  "grading_mode": "${shouldEnforceWorkShown ? "work_required" : isMathAssignment ? "answer_only" : enhancedMode ? "enhanced" : hasAnswerKey ? "answer_key_assisted" : "rubric_only"}",
  "work_requirement_enforced": ${shouldEnforceWorkShown},
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
  ${isMathAssignment ? `"question_breakdown": [
    {
      "question_number": <number>,
      "question_text": "<brief description of the problem, e.g., 'x + 8 = 15'>",
      "possible_points": <number - points for this question>,
      "earned_points": <number - points awarded>,
      "answer_correct": <boolean>,
      "work_shown": <boolean - true if visible work/steps, false if only final answer>,
      "work_shown_details": "<what work was shown OR 'Only final answer visible'>",
      "scoring_reason": "<e.g., 'Full credit - work shown and correct' OR 'Reduced credit - correct answer but no work shown (rubric requires work)' OR 'Full credit - answer correct (rubric does not require work)'>"
    }
  ],` : ""}
  "strengths": ["<3-6 bullets>"],
  "areas_for_improvement": ["<3-6 bullets>${shouldEnforceWorkShown ? " - include note about showing work if applicable" : ""}"],
  "draft_feedback": "<1 paragraph written to the student>",
  "teacher_notes": ["<1-3 bullets about grading decisions, unclear areas, or recommendations>"]
}${shouldEnforceWorkShown ? `

IMPORTANT FOR WORK-REQUIRED GRADING: 
- The question_breakdown must show work_shown=false for any question without visible steps
- If correct answer but no work: earned_points should follow rubric penalty (e.g., max 60% or 3/5)
- Include specific feedback in areas_for_improvement about missing work` : isMathAssignment ? `

IMPORTANT FOR ANSWER-ONLY GRADING:
- DO NOT penalize for missing work
- DO NOT mention "show your work" in feedback
- Award full points for correct answers regardless of whether work is shown
- Focus feedback on accuracy and understanding` : ""}`;

  return { systemPrompt, userPrompt };
}

/**
 * Normalize and validate grading result
 */
function normalizeGradingResult(result: Record<string, unknown>, rubric: ParsedRubric): Record<string, unknown> {
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
  if (suggestedScore && typeof suggestedScore === "object") {
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
  const breakdown = result.rubric_breakdown as
    | Array<{
        criterion: string;
        earned_points: number;
        possible_points: number;
      }>
    | undefined;

  if (breakdown && Array.isArray(breakdown) && breakdown.length > 0) {
    const derivationParts = breakdown.map((b) => `${b.criterion}: ${b.earned_points}/${b.possible_points}`);
    result.score_derivation = derivationParts.join(" | ");
  }

  // Ensure teacher_notes exists
  if (!Array.isArray(result.teacher_notes)) {
    result.teacher_notes = [];
  }

  // Add auto-generated rubric note if applicable
  if (rubric.source === "auto-generated" && Array.isArray(result.teacher_notes)) {
    const hasNote = (result.teacher_notes as string[]).some(
      (n) => n.toLowerCase().includes("auto-generated") || n.toLowerCase().includes("default"),
    );
    if (!hasNote) {
      (result.teacher_notes as string[]).unshift(
        "Scored using Bottor's default 20-point template (no rubric detected). Consider providing a rubric for more precise scoring.",
      );
    }
  }

  // ============================================================
  // RUBRIC COMPLIANCE — deterministic, server-computed audit of
  // which criteria the AI actually graded against vs. which came
  // from the teacher's rubric. Makes AI rubric behavior auditable.
  // ============================================================
  const normalize = (s: string) =>
    String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  const expectedCriteria = rubric.criteria.map((c) => c.name);
  const expectedNorm = expectedCriteria.map(normalize);

  const aiBreakdown =
    (result.rubric_breakdown as Array<{ criterion?: string }> | undefined) || [];
  const actualCriteria = aiBreakdown
    .map((b) => String(b?.criterion || "").trim())
    .filter(Boolean);
  const actualNorm = actualCriteria.map(normalize);

  let complianceStatus: "custom" | "mixed" | "default";
  if (rubric.source === "auto-generated") {
    complianceStatus = "default";
  } else {
    const extra = actualNorm.filter((n) => !expectedNorm.includes(n));
    const missing = expectedNorm.filter((n) => !actualNorm.includes(n));
    complianceStatus =
      actualNorm.length > 0 && extra.length === 0 && missing.length === 0
        ? "custom"
        : "mixed";
  }

  const criteriaUsedList = (actualCriteria.length > 0 ? actualCriteria : expectedCriteria).map(
    (name) => {
      const fromTeacher =
        rubric.source === "teacher" && expectedNorm.includes(normalize(name));
      return { name, source: fromTeacher ? "teacher" : "default" };
    },
  );

  (result as any).rubric_compliance = {
    status: complianceStatus,
    rubric_source: rubric.source,
    criteria_used: criteriaUsedList,
    expected_criteria: expectedCriteria,
    actual_criteria: actualCriteria,
    mismatches: {
      extra: actualCriteria.filter((c) => !expectedNorm.includes(normalize(c))),
      missing: expectedCriteria.filter((c) => !actualNorm.includes(normalize(c))),
    },
  };

  return result;
}

function forceCorrectPerformanceLevelMapping(
  result: Record<string, unknown>,
  parsedRubric: ParsedRubric,
  rubricText?: string,
): Record<string, unknown> {
  const LEVEL_TO_PERCENT: Record<number, number> = { 4: 1.0, 3: 0.75, 2: 0.5, 1: 0.25 };

  // Only apply this forced mapping when we have explicit weighted categories summing to 100
  // AND the provided rubric text contains 4-level performance descriptors.
  const criteriaSum = parsedRubric.criteria.reduce((acc, c) => acc + (Number(c.points) || 0), 0);
  const hasExplicitCategoryWeights =
    parsedRubric.criteria.length >= 2 && criteriaSum >= 10 && criteriaSum === parsedRubric.totalPoints;

  const looksLikeFourLevelDescriptors = (() => {
    const t = (rubricText || "").toLowerCase();
    // Numeric level patterns
    const hasNumericLevels =
      /\b4\s*[=:]\s*\w+/.test(t) &&
      /\b3\s*[=:]\s*\w+/.test(t) &&
      /\b2\s*[=:]\s*\w+/.test(t) &&
      /\b1\s*[=:]\s*\w+/.test(t);
    // Common labels
    const hasCommonLabels = t.includes("proficient") && (t.includes("excellent") || t.includes("exemplary"));
    return hasNumericLevels || hasCommonLabels;
  })();

  const isWeighted100Rubric = hasExplicitCategoryWeights && parsedRubric.totalPoints === 100 && criteriaSum === 100;
  if (!isWeighted100Rubric || !looksLikeFourLevelDescriptors) return result;

  const breakdown = result.rubric_breakdown as
    | Array<{
        criterion?: string;
        earned_points?: number;
        possible_points?: number;
        evidence?: string;
      }>
    | undefined;

  if (!breakdown || !Array.isArray(breakdown) || breakdown.length === 0) return result;

  let correctedTotal = 0;
  const correctedBreakdown = breakdown.map((item) => {
    const possiblePoints = Number(item.possible_points) || 0;
    const earnedPoints = Number(item.earned_points) || 0;
    if (possiblePoints <= 0) return item;

    const evidenceText = (item.evidence || "").toLowerCase();
    const rawRatio = earnedPoints / possiblePoints;

    // CRITICAL: Always prioritize explicit level/label mentions in evidence text
    let detectedLevel: 1 | 2 | 3 | 4 = 4;

    // First check: Look for explicit performance level indicators in evidence
    if (/(\blevel\s*4\b|\bexcellent\b|\bexemplary\b|\ball\s+correct\b|5\s*\/\s*5|perfect)/i.test(evidenceText)) {
      detectedLevel = 4;
    } else if (
      /(\blevel\s*3\b|\bproficient\b|\bcompetent\b|4\s*out\s*of\s*5|4\s*\/\s*5|generally\s+correct|minor\s+error)/i.test(
        evidenceText,
      )
    ) {
      detectedLevel = 3;
    } else if (/(\blevel\s*2\b|\bdeveloping\b|\bbasic\b|2-3|some\s+correct)/i.test(evidenceText)) {
      detectedLevel = 2;
    } else if (/(\blevel\s*1\b|\bbeginning\b|\bneeds\s*work\b|0-1|little\s+to\s+no)/i.test(evidenceText)) {
      detectedLevel = 1;
    } else {
      // Fallback: Map AI's percentage back to intended level
      // The AI sometimes outputs wrong percentages (50%, 60%, 80%) so we correct them
      if (rawRatio >= 0.95)
        detectedLevel = 4; // 95-100% = Excellent (Level 4)
      else if (rawRatio >= 0.65)
        detectedLevel = 3; // 65-94% = Proficient (Level 3) - catches 75%, 80%
      else if (rawRatio >= 0.4)
        detectedLevel = 2; // 40-64% = Developing (Level 2) - catches 50%, 60%
      else detectedLevel = 1; // 0-39% = Beginning (Level 1)
    }

    const correctPercent = LEVEL_TO_PERCENT[detectedLevel];
    const correctedEarned = Math.round(possiblePoints * correctPercent);
    correctedTotal += correctedEarned;

    return {
      ...item,
      earned_points: correctedEarned,
    };
  });

  // Update totals + display fields to match corrected breakdown.
  const totalPossible = parsedRubric.totalPoints;
  const correctedPercent = totalPossible > 0 ? Math.round((correctedTotal / totalPossible) * 100) : 0;
  (result as any).rubric_breakdown = correctedBreakdown;
  (result as any).total_score = correctedTotal;
  (result as any).max_score = totalPossible;
  (result as any).score_suggestion = `${correctedTotal}/${totalPossible}`;
  (result as any).score_percent = correctedPercent;
  (result as any).letter_grade = getLetterGrade(correctedPercent);

  const suggestedScore = (result as any).suggested_score;
  if (suggestedScore && typeof suggestedScore === "object") {
    (suggestedScore as any).earned_points = correctedTotal;
    (suggestedScore as any).possible_points = totalPossible;
    (suggestedScore as any).display = `${correctedTotal}/${totalPossible}`;
    (suggestedScore as any).percent = correctedPercent;
    (suggestedScore as any).letter_grade = getLetterGrade(correctedPercent);
  }

  // Keep derivation consistent with corrected breakdown.
  (result as any).score_derivation = correctedBreakdown
    .map((b) => `${b.criterion ?? "(criterion)"}: ${Number(b.earned_points) || 0}/${Number(b.possible_points) || 0}`)
    .join(" | ");

  // Add a transparent note for teachers.
  if (!Array.isArray((result as any).teacher_notes)) (result as any).teacher_notes = [];
  const notes = (result as any).teacher_notes as string[];
  const alreadyNoted = notes.some((n) => n.toLowerCase().includes("forced performance-level mapping"));
  if (!alreadyNoted) {
    notes.unshift(
      "Applied forced performance-level mapping for weighted 100-point rubric (Level 4=100%, Level 3=75%, Level 2=50%, Level 1=25%) to prevent incorrect 60%/80% scaling.",
    );
  }

  console.log(
    `[grade-paper] Forced performance-level mapping applied. Corrected total: ${correctedTotal}/${totalPossible} (${correctedPercent}%)`,
  );

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

// =============================================================================
// Rubric fidelity + self-consistency validators
// =============================================================================

function _normalizeName(s: string): string {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const _TOPIC_SYNONYMS: Record<string, string[]> = {
  conventions: ["comma","semicolon","grammar","spelling","punctuation","capitalization","run-on","run on","splice","apostrophe","tense","subject-verb","verb agreement","mechanics"],
  organization: ["transition","structure","flow","introduction","conclusion","paragraph","sequence","order","cohesion"],
  ideas: ["thesis","claim","evidence","support","development","detail","focus","argument"],
  content: ["thesis","claim","evidence","support","development","detail","focus","argument"],
  thesis: ["thesis","claim","central claim"],
  evidence: ["quote","citation","textual evidence","support","reference"],
  analysis: ["analysis","reasoning","explanation","interpretation","insight"],
  voice: ["tone","audience","engagement","personality"],
  word: ["vocabulary","word choice","diction","repetition","precise","language"],
  fluency: ["sentence variety","sentence structure","rhythm","choppy"],
  accuracy: ["incorrect","wrong","error","mistake","miscalculation","calculation error"],
  work: ["steps","setup","process","method","show your work","reasoning shown"],
  completeness: ["missing","skipped","incomplete","unfinished"],
};

function _topicsForCriterion(name: string): string[] {
  const n = _normalizeName(name);
  const out = new Set<string>();
  if (n) out.add(n);
  for (const key of Object.keys(_TOPIC_SYNONYMS)) {
    if (n.includes(key)) _TOPIC_SYNONYMS[key].forEach((s) => out.add(s.toLowerCase()));
  }
  n.split(/\s+/).filter((w) => w.length >= 4).forEach((w) => out.add(w));
  return Array.from(out);
}

/**
 * Strip any rubric_breakdown entry whose normalized criterion name doesn't
 * match a teacher-provided criterion. Only runs when rubric.source === "teacher".
 * Re-syncs total_score / score_suggestion / score_percent after stripping.
 */
function enforceCriterionWhitelist(
  result: Record<string, unknown>,
  rubric: ParsedRubric,
): Record<string, unknown> {
  if (rubric.source !== "teacher") return result;
  const expected = rubric.criteria.map((c) => _normalizeName(c.name));
  if (expected.length === 0) return result;

  const breakdown = (result.rubric_breakdown as Array<Record<string, unknown>> | undefined) || [];
  if (breakdown.length === 0) return result;

  const stripped: string[] = [];
  const filtered = breakdown.filter((b) => {
    const name = String(b?.criterion || "");
    const ok = expected.includes(_normalizeName(name));
    if (!ok) stripped.push(name);
    return ok;
  });
  if (stripped.length === 0) return result;

  console.warn(`[grade-paper] Stripped ${stripped.length} invented criteria:`, stripped);

  const newEarned = filtered.reduce((s, b) => s + (Number(b.earned_points) || 0), 0);
  const totalPossible = rubric.totalPoints;
  const newPercent = totalPossible > 0 ? Math.round((newEarned / totalPossible) * 100) : 0;

  (result as any).rubric_breakdown = filtered;
  (result as any).total_score = newEarned;
  (result as any).max_score = totalPossible;
  (result as any).score_suggestion = `${newEarned}/${totalPossible}`;
  (result as any).score_percent = newPercent;
  (result as any).letter_grade = getLetterGrade(newPercent);
  const ss = (result as any).suggested_score;
  if (ss && typeof ss === "object") {
    ss.earned_points = newEarned;
    ss.possible_points = totalPossible;
    ss.display = `${newEarned}/${totalPossible}`;
    ss.percent = newPercent;
    ss.letter_grade = getLetterGrade(newPercent);
  }
  (result as any).score_derivation = filtered
    .map((b) => `${b.criterion ?? "(criterion)"}: ${Number(b.earned_points) || 0}/${Number(b.possible_points) || 0}`)
    .join(" | ");

  if (!Array.isArray((result as any).teacher_notes)) (result as any).teacher_notes = [];
  ((result as any).teacher_notes as string[]).unshift(
    `Removed ${stripped.length} AI-invented criterion name(s) not in your rubric: ${stripped.join(", ")}.`,
  );

  return result;
}

interface ConsistencyAdjustment {
  criterion: string;
  matched_note: string;
  original_earned: number;
  adjusted_earned: number;
}

/**
 * For each criterion at full marks, scan areas_for_improvement for any item
 * that mentions a related topic. If a match is found, deduct 1 point and
 * record the adjustment under consistency_check.
 */
function runConsistencyCheckOnResult(
  result: Record<string, unknown>,
  rubric: ParsedRubric,
): Record<string, unknown> {
  const breakdown = (result.rubric_breakdown as Array<Record<string, unknown>> | undefined) || [];
  const areas = (result.areas_for_improvement as string[] | undefined) || [];
  const adjustments: ConsistencyAdjustment[] = [];

  const corrected = breakdown.map((item) => {
    const earned = Number(item.earned_points) || 0;
    const possible = Number(item.possible_points) || 0;
    if (possible <= 0 || earned < possible) return item;
    const name = String(item.criterion || "");
    const topics = _topicsForCriterion(name);
    const flagged = areas.find((a) => {
      const text = String(a).toLowerCase();
      return topics.some((t) => t.length >= 3 && text.includes(t));
    });
    if (!flagged) return item;
    const adjustedEarned = Math.max(0, earned - 1);
    adjustments.push({
      criterion: name,
      matched_note: String(flagged),
      original_earned: earned,
      adjusted_earned: adjustedEarned,
    });
    return { ...item, earned_points: adjustedEarned };
  });

  (result as any).consistency_check = {
    passed: adjustments.length === 0,
    adjustments,
  };

  if (adjustments.length === 0) return result;

  console.warn(`[grade-paper] Consistency adjustments:`, adjustments);

  const newEarned = corrected.reduce((s, b) => s + (Number(b.earned_points) || 0), 0);
  const totalPossible = rubric.totalPoints;
  const newPercent = totalPossible > 0 ? Math.round((newEarned / totalPossible) * 100) : 0;

  (result as any).rubric_breakdown = corrected;
  (result as any).total_score = newEarned;
  (result as any).max_score = totalPossible;
  (result as any).score_suggestion = `${newEarned}/${totalPossible}`;
  (result as any).score_percent = newPercent;
  (result as any).letter_grade = getLetterGrade(newPercent);
  const ss = (result as any).suggested_score;
  if (ss && typeof ss === "object") {
    ss.earned_points = newEarned;
    ss.display = `${newEarned}/${totalPossible}`;
    ss.percent = newPercent;
    ss.letter_grade = getLetterGrade(newPercent);
  }
  (result as any).score_derivation = corrected
    .map((b) => `${b.criterion ?? "(criterion)"}: ${Number(b.earned_points) || 0}/${Number(b.possible_points) || 0}`)
    .join(" | ");

  if (!Array.isArray((result as any).teacher_notes)) (result as any).teacher_notes = [];
  ((result as any).teacher_notes as string[]).unshift(
    `Auto-adjusted ${adjustments.length} criterion score(s) for self-consistency (full marks with related improvement note).`,
  );

  return result;
}
