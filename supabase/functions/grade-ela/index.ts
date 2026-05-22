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
import { parseRubricCriteria as sharedParseRubric } from "../_shared/rubricParser.ts";

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
  /**
   * When true, grading runs normally and the full response is returned, but
   * the caller MUST treat the run as ephemeral: no writes to `submissions`,
   * `submission_batches`, or any other persistent table; no billing/usage
   * events. The response will include `dry_run: true` so callers can assert.
   * This edge function itself does not persist anything — persistence is
   * caller-side — so the flag is informational and echoed back.
   */
  dry_run?: boolean;
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
      dry_run,
    } = body;

    if (dry_run) {
      console.log("[grade-ela] DRY RUN — response will not be persisted by caller");
    }

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

    return new Response(JSON.stringify({ ...gradingResult, dry_run: dry_run === true }), {
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
- Be honest first, encouraging second. Inflated scores do not help students improve.
- Focus on specific evidence from the student's work
- Provide actionable feedback that helps students improve
- Consider grade-level expectations when scoring
- Award credit for genuine partial success, but do NOT inflate scores to "be kind"
${assignmentDocText?.trim() ? "- When source material is provided, verify any quotes against it and call out misinterpretations or unsupported claims" : ""}

SCORE CALIBRATION (CRITICAL — middle school writing distribution):
- Real middle school writing follows a wide distribution. Strong responses (90+) should be RARE.
- Most competent responses fall in the 75–88 range.
- Responses with significant flaws fall in the 60–74 range.
- Responses with fundamental errors fall BELOW 60. Do not avoid scores in this range when warranted.
- Do NOT anchor toward the middle of the rubric range. If a criterion deserves 18/25, score it 18/25 — do not nudge to 22/25 to be encouraging. Use the full point range.
- A response that retells the assigned text without making an argument cannot receive Proficient or higher on Thesis/Claim, regardless of writing quality.
- A response that contains a fundamental misreading of the source material cannot receive Proficient or higher on Analysis, regardless of structural competence elsewhere.

HOLISTIC READING (CRITICAL — no fragmentary credit):
- Evaluate the response AS A WHOLE. A correct claim in the final paragraph does not redeem fundamental errors in earlier paragraphs.
- A response that begins with a misreading and stumbles toward the right answer should reflect BOTH — credit the partial understanding, but score the misreading honestly.
- Do not cherry-pick moments of partial understanding while ignoring fundamental errors elsewhere.
${assignmentDocText?.trim() ? `
FUNDAMENTAL MISREAD CHECK (run BEFORE assigning criterion scores):
- Identify the central concept/metaphor/argument of the source material.
- Determine whether the student's central claim aligns with that meaning.
- If the response contradicts the source (e.g., interpreting a story about sentimental value as a story about monetary value), flag this explicitly at the top of teacher_notes as "FUNDAMENTAL MISREAD: <description>".
- A response built on a misread of the central concept cannot earn full Analysis credit even if portions are competent. Reflect this in the Analysis score.` : ""}

${rubricSection}

SCORING RULES:
1. Score each criterion on a scale from 0 to its max points
2. Base scores on specific evidence from the writing
3. Use the full range of the scale - don't cluster in the middle or upper-middle
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

  let areasForImprovement = Array.isArray(result.areas_for_improvement)
    ? result.areas_for_improvement
    : typeof result.areas_for_improvement === 'string'
      ? [result.areas_for_improvement]
      : ["Continue practicing writing skills"];

  // ---- Server-side criterion-name validator ----
  // If teacher rubric is provided and parseable, strip any criterion in the
  // response whose normalized name doesn't appear in the rubric.
  const expectedCriteriaNames = rubricText?.trim()
    ? extractRubricCriterionNames(rubricText)
    : [];
  const teacherProvided = expectedCriteriaNames.length > 0;
  const expectedNorm = expectedCriteriaNames.map(normalizeName);

  let breakdown: any[] = Array.isArray(result.criterion_breakdown)
    ? result.criterion_breakdown
    : [];

  if (teacherProvided && breakdown.length > 0) {
    const before = breakdown.length;
    const stripped: string[] = [];
    breakdown = breakdown.filter((b: any) => {
      const name = String(b?.criterion || "");
      const ok = expectedNorm.includes(normalizeName(name));
      if (!ok) stripped.push(name);
      return ok;
    });
    if (stripped.length > 0) {
      console.warn(`[grade-ela] Stripped ${stripped.length}/${before} invented criteria not in teacher rubric:`, stripped);
    }
  }

  // ---- Self-consistency validator ----
  // For any criterion at full marks, scan areas_for_improvement for matches.
  // If found, deduct 1 point and surface in consistency_check.
  const consistency = runConsistencyCheck(breakdown, areasForImprovement);
  if (consistency.adjustments.length > 0) {
    console.warn(`[grade-ela] Consistency adjustments:`, consistency.adjustments);
  }
  breakdown = consistency.correctedBreakdown;

  // Recompute totals from corrected breakdown (only if breakdown is meaningful)
  let earned = typeof result.earned === 'number' ? result.earned : 0;
  let possible = typeof result.possible === 'number' ? result.possible : 100;
  if (breakdown.length > 0) {
    const sumEarned = breakdown.reduce((s: number, b: any) => s + (Number(b.earned) || 0), 0);
    const sumPossible = breakdown.reduce((s: number, b: any) => s + (Number(b.possible) || 0), 0);
    if (sumPossible > 0) {
      earned = sumEarned;
      possible = sumPossible;
    }
  }
  const percent = Math.round((earned / Math.max(possible, 1)) * 100);

  // Determine letter grade if not provided
  let letterGrade = result.letter_grade;
  if (!letterGrade || consistency.adjustments.length > 0) {
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
    criterion_breakdown: breakdown.length > 0 ? breakdown : undefined,
    teacher_notes: typeof result.teacher_notes === 'string'
      ? result.teacher_notes
      : undefined,
    consistency_check: {
      passed: consistency.adjustments.length === 0,
      adjustments: consistency.adjustments,
    },
    rubric_used: teacherProvided
      ? {
          scale: possible,
          criteria_count: breakdown.length || expectedCriteriaNames.length,
          source: "teacher",
        }
      : {
          scale: DEFAULT_ELA_RUBRIC.scale,
          criteria_count: DEFAULT_ELA_RUBRIC.criteria.length,
          source: "default",
        },
  };
}

// =============================================================================
// Shared validators (also inlined in grade-paper)
// =============================================================================

function normalizeName(s: string): string {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Extract rubric criterion names via the shared canonical parser
 * (single source of truth in supabase/functions/_shared/rubricParser.ts).
 */
function extractRubricCriterionNames(text: string): string[] {
  if (!text?.trim()) return [];
  const parsed = sharedParseRubric(text);
  if (parsed.status !== "valid") return [];
  return parsed.criteria
    .filter((c) => !c.isBonus)
    .map((c) => c.name);
}

const TOPIC_SYNONYMS: Record<string, string[]> = {
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

function topicsForCriterion(name: string): string[] {
  const n = normalizeName(name);
  const out = new Set<string>();
  if (n) out.add(n);
  for (const key of Object.keys(TOPIC_SYNONYMS)) {
    if (n.includes(key)) TOPIC_SYNONYMS[key].forEach((s) => out.add(s.toLowerCase()));
  }
  // Each word of the criterion name (>=4 chars) as a fallback signal
  n.split(/\s+/).filter((w) => w.length >= 4).forEach((w) => out.add(w));
  return Array.from(out);
}

interface ConsistencyAdjustment {
  criterion: string;
  matched_note: string;
  original_earned: number;
  adjusted_earned: number;
}

function runConsistencyCheck(
  breakdown: any[],
  areas: string[],
): { correctedBreakdown: any[]; adjustments: ConsistencyAdjustment[] } {
  const adjustments: ConsistencyAdjustment[] = [];
  const corrected = (breakdown || []).map((item) => {
    const earnedField = "earned_points" in item ? "earned_points" : "earned";
    const possibleField = "possible_points" in item ? "possible_points" : "possible";
    const earned = Number(item[earnedField]) || 0;
    const possible = Number(item[possibleField]) || 0;
    if (possible <= 0 || earned < possible) return item;
    const name = String(item.criterion || "");
    const topics = topicsForCriterion(name);
    const flagged = (areas || []).find((a) => {
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
    return { ...item, [earnedField]: adjustedEarned };
  });
  return { correctedBreakdown: corrected, adjustments };
}

