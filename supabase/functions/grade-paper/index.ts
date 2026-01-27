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
 * INSTRUCTION-AWARE SCORING (for question-based assignments):
 * - Parses directions to extract allowed error types (homophones, contractions, etc.)
 * - Marks answers correct ONLY if they match the required error type from directions
 * - Detects instruction mismatches and explains why answers were marked incorrect
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
  grade_level?: string;
  subject?: string;
  rubric: string;
  answer_key?: string;
  prompt_text?: string;
  assignment_doc_text?: string;  // Text from assignment/rubric documents
  grading_mode: 'scoring' | 'feedback-only';
  scoring_mode?: 'feedback-only' | 'auto-score' | 'rubric-based';  // Flexible scoring mode
  auto_score_settings?: {
    totalPoints: number | null;
    pointsPerQuestion: number | null;
    questionCount: number | null;
    partialCreditAllowed: boolean;
    usePointsPerQuestion: boolean;
  };
  quick_rubric_categories?: string;  // Comma-separated rubric categories with points
}

/**
 * Error type keywords to detect from assignment directions
 */
const ERROR_TYPE_KEYWORDS: Record<string, string[]> = {
  homophone: ['homophone', 'homophones', 'sound alike', 'sounds alike', 'sound-alike'],
  contraction: ['contraction', 'contractions', "apostrophe for missing letters"],
  possessive: ['possessive', 'possessives', 'ownership', "apostrophe for ownership"],
  plural: ['plural', 'plurals', 'more than one'],
  punctuation: ['punctuation', 'comma', 'period', 'apostrophe', 'question mark', 'exclamation'],
  capitalization: ['capitalization', 'capital letter', 'capital letters', 'uppercase'],
  spelling: ['spelling', 'misspelled', 'misspell', 'spell correctly', 'correct spelling'],
  grammar: ['grammar', 'grammatical', 'verb tense', 'subject-verb'],
  targeted_word_replacement: ['identify the error', 'cross it out', 'cross out', 'write the correct word', 'find the error', 'circle the error', 'underline the error', 'fix the error']
};

/**
 * Common homophone pairs for detection
 */
const HOMOPHONE_PAIRS: string[][] = [
  ['their', 'there', 'they\'re'],
  ['your', 'you\'re'],
  ['its', 'it\'s'],
  ['to', 'too', 'two'],
  ['then', 'than'],
  ['were', 'where', 'we\'re', 'wear'],
  ['hear', 'here'],
  ['whether', 'weather'],
  ['accept', 'except'],
  ['affect', 'effect'],
  ['principal', 'principle'],
  ['stationary', 'stationery'],
  ['complement', 'compliment'],
  ['desert', 'dessert'],
  ['loose', 'lose'],
  ['passed', 'past'],
  ['peace', 'piece'],
  ['right', 'write'],
  ['through', 'threw'],
  ['allowed', 'aloud'],
  ['break', 'brake'],
  ['buy', 'by', 'bye'],
  ['knew', 'new'],
  ['know', 'no'],
  ['our', 'hour'],
  ['sight', 'site', 'cite'],
  ['tail', 'tale'],
  ['wait', 'weight'],
  ['week', 'weak'],
  ['which', 'witch'],
  ['whole', 'hole']
];

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
      rubric, 
      answer_key, 
      prompt_text,
      assignment_doc_text,
      grading_mode = 'feedback-only',
      scoring_mode = 'feedback-only',
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

    console.log(`[grade-paper] Grading in ${scoring_mode} mode for ${grade_level || 'unspecified'} ${subject || 'unspecified'}`);
    if (auto_score_settings) {
      console.log(`[grade-paper] Auto-score settings:`, JSON.stringify(auto_score_settings));
    }
    if (quick_rubric_categories) {
      console.log(`[grade-paper] Quick rubric categories:`, quick_rubric_categories);
    }

    // Parse directions to extract allowed error types (instruction-aware scoring)
    const allText = [student_work, assignment_doc_text || '', rubric || ''].join('\n');
    const allowedErrorTypes = parseDirectionsForErrorTypes(allText);
    console.log(`[grade-paper] Detected allowed error types:`, allowedErrorTypes);

    // Build the grading prompt based on mode
    const prompt = buildGradingPrompt(body, allowedErrorTypes);
    const systemPrompt = buildSystemPrompt(scoring_mode, rubric, answer_key, auto_score_settings, quick_rubric_categories, allowedErrorTypes);

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
        max_tokens: 3000,
        temperature: 0.3, // Lower temperature for more consistent scoring
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

      // Add instruction-aware scoring metadata
      gradingResult.allowed_error_types = allowedErrorTypes;
      
      // Check for high "unable to determine" rate
      const perQuestion = gradingResult.per_question as Array<{ reason?: string }> | undefined;
      if (perQuestion && Array.isArray(perQuestion)) {
        const unableToDetermineCount = perQuestion.filter(q => 
          q.reason?.toLowerCase().includes('unable to determine') ||
          q.reason?.toLowerCase().includes('cannot determine')
        ).length;
        
        if (perQuestion.length > 0 && unableToDetermineCount / perQuestion.length > 0.2) {
          gradingResult.scoring_warning = "Some answers couldn't be reliably matched to the target word. Review recommended.";
        }
      }

      // Compute numeric score based on scoring mode
      if (scoring_mode === 'feedback-only') {
        // Feedback-only mode: no numeric score
        gradingResult.score_suggestion = "N/A";
        gradingResult.total_score = null;
        gradingResult.max_score = null;
      } else if (scoring_mode === 'auto-score' && auto_score_settings) {
        // Auto-score mode: compute score from AI response or per-question data
        const computedScore = computeAutoScore(gradingResult, auto_score_settings);
        gradingResult.total_score = computedScore.earned;
        gradingResult.max_score = computedScore.possible;
        gradingResult.score_suggestion = `${computedScore.earned}/${computedScore.possible}`;
        
        // Use AI's derivation or generate one
        if (!gradingResult.score_derivation && computedScore.derivation) {
          gradingResult.score_derivation = computedScore.derivation;
        }
        
        // Add breakdown counts
        gradingResult.correct_count = computedScore.correctCount;
        gradingResult.incorrect_count = computedScore.incorrectCount;
        gradingResult.partial_count = computedScore.partialCount;
      } else if (scoring_mode === 'rubric-based') {
        // Rubric-based: use AI's score directly
        if (typeof gradingResult.total_score === 'number' && gradingResult.max_score) {
          gradingResult.score_suggestion = `${gradingResult.total_score}/${gradingResult.max_score}`;
        } else if (gradingResult.qualitative_rating) {
          gradingResult.score_suggestion = gradingResult.qualitative_rating;
        } else {
          gradingResult.score_suggestion = "N/A";
        }
      } else {
        // Legacy grading_mode fallback
        if (grading_mode === 'feedback-only') {
          gradingResult.score_suggestion = "N/A";
          gradingResult.total_score = null;
        } else if (typeof gradingResult.total_score === 'number' && gradingResult.max_score) {
          gradingResult.score_suggestion = `${gradingResult.total_score}/${gradingResult.max_score}`;
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
        score_suggestion: scoring_mode === 'feedback-only' ? "N/A" : "Unable to determine - please review manually",
        strengths: "Unable to parse AI response",
        areas_for_improvement: "Manual review required - AI parsing failed",
        feedback_paragraph: "Please review this work and provide personalized feedback.",
      };
    }

    console.log("[grade-paper] Grading complete, mode:", scoring_mode, "score:", gradingResult.score_suggestion);

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
 * Parse assignment directions to extract allowed error types
 * Returns array of error type strings that the directions specify
 */
function parseDirectionsForErrorTypes(text: string): string[] {
  const lowerText = text.toLowerCase();
  const detectedTypes: Set<string> = new Set();
  
  // Check for each error type keyword
  for (const [errorType, keywords] of Object.entries(ERROR_TYPE_KEYWORDS)) {
    for (const keyword of keywords) {
      if (lowerText.includes(keyword)) {
        detectedTypes.add(errorType);
        break;
      }
    }
  }
  
  // If no specific error types detected, return 'unknown'
  if (detectedTypes.size === 0) {
    return ['unknown'];
  }
  
  return Array.from(detectedTypes);
}

/**
 * Check if a word is part of a homophone pair
 */
function isHomophone(word: string): boolean {
  const lowerWord = word.toLowerCase();
  return HOMOPHONE_PAIRS.some(pair => pair.includes(lowerWord));
}

/**
 * Get the homophone group for a word
 */
function getHomophoneGroup(word: string): string[] | null {
  const lowerWord = word.toLowerCase();
  for (const pair of HOMOPHONE_PAIRS) {
    if (pair.includes(lowerWord)) {
      return pair;
    }
  }
  return null;
}

/**
 * Compute auto-score from AI response data with instruction-aware logic
 * Ensures numeric score is always calculated when auto-score settings are provided
 */
function computeAutoScore(
  aiResponse: Record<string, unknown>,
  settings: {
    totalPoints: number | null;
    pointsPerQuestion: number | null;
    questionCount: number | null;
    partialCreditAllowed: boolean;
    usePointsPerQuestion: boolean;
  }
): { earned: number; possible: number; derivation: string; correctCount: number; incorrectCount: number; partialCount: number } {
  
  // Calculate from per-question data if available
  const perQuestion = aiResponse.per_question as Array<{
    correct?: boolean | 'partial';
    points_earned?: number;
    points_possible?: number;
    reason?: string;
  }> | undefined;

  let numCorrect = 0;
  let numPartial = 0;
  let numIncorrect = 0;

  if (perQuestion && Array.isArray(perQuestion) && perQuestion.length > 0) {
    let totalEarned = 0;
    let totalPossible = 0;

    for (const q of perQuestion) {
      if (typeof q.points_earned === 'number') {
        totalEarned += q.points_earned;
      }
      if (typeof q.points_possible === 'number') {
        totalPossible += q.points_possible;
      }
      
      // Count correct/partial/incorrect
      if (q.correct === true) numCorrect++;
      else if (q.correct === 'partial') numPartial++;
      else numIncorrect++;
    }

    // If AI provided points, use those
    if (totalPossible > 0) {
      const derivation = buildScoreDerivation(numCorrect, numPartial, numIncorrect, totalEarned, totalPossible, settings);
      return { earned: totalEarned, possible: totalPossible, derivation, correctCount: numCorrect, incorrectCount: numIncorrect, partialCount: numPartial };
    }
  }

  // If AI already provided valid total_score and max_score, use them
  if (typeof aiResponse.total_score === 'number' && typeof aiResponse.max_score === 'number') {
    // Try to get counts from response
    numCorrect = typeof aiResponse.num_correct === 'number' ? aiResponse.num_correct : 0;
    numPartial = typeof aiResponse.num_partial === 'number' ? aiResponse.num_partial : 0;
    numIncorrect = typeof aiResponse.num_incorrect === 'number' ? aiResponse.num_incorrect : 0;
    
    return {
      earned: aiResponse.total_score as number,
      possible: aiResponse.max_score as number,
      derivation: (aiResponse.score_derivation as string) || `Score: ${aiResponse.total_score}/${aiResponse.max_score}`,
      correctCount: numCorrect,
      incorrectCount: numIncorrect,
      partialCount: numPartial
    };
  }

  // Fallback: compute from settings + any correctness counts AI provided
  numCorrect = typeof aiResponse.num_correct === 'number' ? aiResponse.num_correct : 0;
  numPartial = typeof aiResponse.num_partial === 'number' ? aiResponse.num_partial : 0;
  numIncorrect = typeof aiResponse.num_incorrect === 'number' ? aiResponse.num_incorrect : 0;
  const totalQuestions = numCorrect + numPartial + numIncorrect;

  if (settings.usePointsPerQuestion && settings.pointsPerQuestion !== null && settings.questionCount !== null) {
    // Points per question mode
    const ppq = settings.pointsPerQuestion;
    const qCount = settings.questionCount;
    const possible = ppq * qCount;
    
    // Calculate earned: full points for correct, half for partial (if allowed), 0 for incorrect
    const partialValue = settings.partialCreditAllowed ? Math.round(ppq * 0.5 * 10) / 10 : 0;
    const earned = (numCorrect * ppq) + (numPartial * partialValue);
    
    const derivation = buildScoreDerivation(numCorrect, numPartial, numIncorrect, earned, possible, settings);
    return { earned: Math.round(earned * 10) / 10, possible, derivation, correctCount: numCorrect, incorrectCount: numIncorrect, partialCount: numPartial };
    
  } else if (settings.totalPoints !== null) {
    // Total points mode - distribute proportionally
    const possible = settings.totalPoints;
    
    if (totalQuestions > 0) {
      const correctWeight = numCorrect / totalQuestions;
      const partialWeight = settings.partialCreditAllowed ? (numPartial * 0.5) / totalQuestions : 0;
      const earned = Math.round(possible * (correctWeight + partialWeight) * 10) / 10;
      
      const derivation = buildScoreDerivation(numCorrect, numPartial, numIncorrect, earned, possible, settings);
      return { earned, possible, derivation, correctCount: numCorrect, incorrectCount: numIncorrect, partialCount: numPartial };
    }
    
    // No question data - return what AI gave or N/A
    if (typeof aiResponse.total_score === 'number') {
      return {
        earned: aiResponse.total_score as number,
        possible,
        derivation: `Score: ${aiResponse.total_score}/${possible}`,
        correctCount: 0,
        incorrectCount: 0,
        partialCount: 0
      };
    }
    
    return { earned: 0, possible, derivation: "Unable to determine score from student work", correctCount: 0, incorrectCount: 0, partialCount: 0 };
  }

  // No valid settings - shouldn't happen but handle gracefully
  return { earned: 0, possible: 0, derivation: "No scoring rules configured", correctCount: 0, incorrectCount: 0, partialCount: 0 };
}

/**
 * Build a human-readable score derivation string
 */
function buildScoreDerivation(
  numCorrect: number,
  numPartial: number,
  numIncorrect: number,
  earned: number,
  possible: number,
  settings: {
    pointsPerQuestion?: number | null;
    partialCreditAllowed: boolean;
    usePointsPerQuestion: boolean;
  }
): string {
  const parts: string[] = [];
  
  if (settings.usePointsPerQuestion && settings.pointsPerQuestion) {
    const ppq = settings.pointsPerQuestion;
    
    if (numCorrect > 0) {
      parts.push(`${numCorrect} fully correct (${numCorrect * ppq} pts)`);
    }
    if (numPartial > 0 && settings.partialCreditAllowed) {
      const partialPts = Math.round(numPartial * ppq * 0.5 * 10) / 10;
      parts.push(`${numPartial} partial (${partialPts} pts)`);
    }
    if (numIncorrect > 0) {
      parts.push(`${numIncorrect} incorrect (0 pts)`);
    }
  } else {
    // Total points mode
    const total = numCorrect + numPartial + numIncorrect;
    if (total > 0) {
      if (numCorrect > 0) parts.push(`${numCorrect} correct`);
      if (numPartial > 0) parts.push(`${numPartial} partial`);
      if (numIncorrect > 0) parts.push(`${numIncorrect} incorrect`);
    }
  }
  
  if (parts.length === 0) {
    return `Score: ${earned}/${possible}`;
  }
  
  return `${parts.join(', ')} = ${earned}/${possible}`;
}

/**
 * Build system prompt based on scoring mode with instruction-aware logic
 */
function buildSystemPrompt(
  scoringMode: 'feedback-only' | 'auto-score' | 'rubric-based', 
  rubric: string,
  answerKey?: string,
  autoScoreSettings?: {
    totalPoints: number | null;
    pointsPerQuestion: number | null;
    questionCount: number | null;
    partialCreditAllowed: boolean;
    usePointsPerQuestion: boolean;
  },
  quickRubricCategories?: string,
  allowedErrorTypes?: string[]
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

  // Build instruction-aware scoring rules for auto-score mode
  const instructionAwareRules = buildInstructionAwareRules(allowedErrorTypes || ['unknown']);

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

${instructionAwareRules}

AUTO-SCORE MODE (Teacher-defined point rules):
Calculate a numeric score using ONLY these teacher-provided settings:
${pointsExplanation}${partialCreditNote}

SCORING PROCESS:
1. Parse any directions/instructions from the assignment to understand the error type being tested
2. Identify each question/item in the student work
3. For each question, determine the EXPECTED error type based on the actual error in the sentence
4. Compare student's correction against the REQUIRED error type from directions
5. Mark CORRECT only if the student fixed the actual erroneous word AND the error type matches directions
6. Mark INCORRECT with reason if student fixed a different word or wrong error type
7. Award points according to the rules above
8. Calculate total earned vs total possible
9. EXPLAIN how you arrived at the score with reason labels

OUTPUT FORMAT (JSON only):
{
  "total_score": <number earned>,
  "max_score": ${autoScoreSettings.usePointsPerQuestion 
    ? (autoScoreSettings.pointsPerQuestion || 0) * (autoScoreSettings.questionCount || 0)
    : autoScoreSettings.totalPoints || 0},
  "score_suggestion": "<earned>/<max>",
  "score_derivation": "<brief explanation of how score was calculated, e.g., '8 of 10 correct at 2 pts each = 16/20'>",
  "num_correct": <number>,
  "num_incorrect": <number>,
  "num_partial": <number>,
  "per_question": [
    {
      "question": "<question number or identifier>",
      "original_sentence": "<the original sentence with the error>",
      "student_correction": "<what the student wrote>",
      "student_target_word": "<the word the student attempted to fix>",
      "expected_error_type": "<homophone|contraction|possessive|plural|punctuation|capitalization|spelling|grammar>",
      "actual_error_word": "<the word that actually contains the error>",
      "correct_answer": "<what the correct answer should be>",
      "correct": <true|false|"partial">,
      "points_earned": <number>,
      "points_possible": <number>,
      "reason": "<'Correct'|'Wrong correction'|'Instruction mismatch'|'Unable to determine target'|'Unscorable (directions don\\'t include this error type)'>",
      "explanation": "<detailed explanation, especially for incorrect answers>"
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

  // Handle rubric-based scoring with Quick Rubric categories
  if (scoringMode === 'rubric-based' && (rubric?.trim() || quickRubricCategories)) {
    const hasPointValues = /\d+\s*(pts?|points?|\/\d+)/i.test(rubric) || !!quickRubricCategories;

    // Quick rubric categories take precedence
    const rubricInfo = quickRubricCategories 
      ? `Teacher-defined rubric categories: ${quickRubricCategories}`
      : `Rubric: ${rubric}`;

    if (hasPointValues) {
      return `${basePrompt}

RUBRIC-BASED SCORING MODE (Numeric):
${rubricInfo}

Calculate a numeric score based strictly on the rubric categories.
- Award points ONLY for criteria that are met in the student work
- Use the exact point values from the rubric categories
- If rubric uses 0/0.5/1 scoring, follow that exactly
- Calculate total score as sum of all category scores
- Infer content type from student work and apply appropriate evaluation

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
- Do NOT assign numeric scores since rubric doesn't specify points
- Infer content type from student work and apply appropriate evaluation

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
  // Check if we have an answer key that can help
  const hasAnswerKey = answerKey && answerKey.trim().length > 0;
  
  if (hasAnswerKey) {
    return `${basePrompt}

FEEDBACK-ONLY MODE (with Answer Key for Reference):
No scoring rules were provided, but an answer key is available.
- Use the answer key to evaluate correctness of responses
- Compare student answers to expected answers
- Do NOT assign a numeric score (no scoring rules provided)
- Provide accuracy-based feedback: which answers are correct, which need work
- Be specific about what the correct answer should be for incorrect items
- Infer content type from student work (objective questions, open-ended, etc.)

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
- Infer content type from student work and provide appropriate feedback

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
 * Build instruction-aware scoring rules based on detected error types
 */
function buildInstructionAwareRules(allowedErrorTypes: string[]): string {
  const isUnknown = allowedErrorTypes.includes('unknown');
  
  if (isUnknown) {
    return `INSTRUCTION-AWARE SCORING:
⚠️ Could not confidently parse error types from directions.
- Evaluate student corrections based on general correctness
- If answer key is provided, use it for reference
- Consider disabling numeric scoring if unsure about grading criteria`;
  }

  const typesList = allowedErrorTypes.map(t => `"${t}"`).join(', ');
  
  return `INSTRUCTION-AWARE SCORING (STRICT):
The assignment directions specify these error types: [${typesList}]

CRITICAL CORRECTNESS RULES:
1. Mark an answer CORRECT only if ALL of these are true:
   a) The student corrected the ACTUAL erroneous word/token in the sentence (not a different word)
   b) The expected error type of that word matches one of the allowed types: [${typesList}]
   c) The correction properly resolves the error (the sentence becomes grammatically correct)

2. INSTRUCTION MISMATCH handling:
   - If student corrects something valid but it's the WRONG CATEGORY for the directions:
   - Mark as INCORRECT with reason = "Instruction mismatch"
   - Explain: "Student changed {word}, but the required error type is {expected}. The target error was {actual_error} → {correct_answer}."
   
3. ERROR TYPE DETECTION:
   - Homophone errors: words that sound alike but spelled differently (their/there, were/where, your/you're)
   - Contraction errors: missing or misplaced apostrophes for contractions (its/it's, your/you're)
   - Possessive errors: apostrophe usage for ownership (student's, teachers')
   - Plural errors: singular vs plural forms (guide/guides)
   - Punctuation errors: commas, periods, question marks
   - Capitalization errors: proper nouns, sentence beginnings
   - Spelling errors: misspelled words (not homophones)
   - Grammar errors: verb tense, subject-verb agreement

4. Common pitfalls to AVOID:
   - Do NOT give credit for fixing capitalization if directions only mention homophones
   - Do NOT give credit for fixing punctuation if directions only mention spelling
   - If student changes "New Mexico" but the actual error was "were" → "where", mark INCORRECT

5. REASON LABELS (use these exact strings):
   - "Correct" - student fixed the right word with the right type of correction
   - "Wrong correction" - student provided wrong answer for the target error
   - "Instruction mismatch" - student fixed a valid error but wrong type for directions
   - "Unable to determine target" - cannot identify which word student was correcting
   - "Unscorable (directions don't include this error type)" - error exists but type not in directions`;
}

/**
 * Build the grading prompt with all context
 */
function buildGradingPrompt(request: GradeRequest, allowedErrorTypes?: string[]): string {
  const { 
    student_work, 
    grade_level, 
    subject, 
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
    `- Scoring Mode: ${scoringModeDesc}`,
  ];

  // Add detected error types info
  if (allowedErrorTypes && allowedErrorTypes.length > 0 && !allowedErrorTypes.includes('unknown')) {
    sections.push(`- Detected Error Types from Directions: ${allowedErrorTypes.join(', ')}`);
  }
  
  sections.push("");

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
      `CITATION REQUIREMENT: When citing rubric criteria in feedback, name the specific category/criterion used.`,
      `SCORING REQUIREMENT: If the rubric contains point values, compute a total score. If the rubric has levels (e.g., Exceeds/Meets/Approaching) but no points, return a level per category and set Suggested Score to 'N/A'.`,
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
      `IMPORTANT: Parse the DIRECTIONS section to understand what type of errors students should correct.`,
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
    `- For question-based work, identify WHICH WORD the student attempted to correct`,
    `- Compare the student's target word against the ACTUAL error in the sentence`,
    ``,
    `--- BEGIN STUDENT WORK ---`,
    student_work,
    `--- END STUDENT WORK ---`,
    ``,
    `Evaluate this work${rubric ? ' against the provided rubric' : ''}. Return JSON only.`
  );

  return sections.join("\n");
}
