/**
 * =============================================================================
 * ORGANIZER GRADER SERVICE
 * =============================================================================
 * 
 * PURPOSE: Grade 8th grade ELA/Social Studies Graphic Essay Organizers (15pt)
 * 
 * SCHEMA: Returns structured JSON with per-source breakdown and actionable feedback
 * =============================================================================
 */

import { supabase } from '@/integrations/supabase/client';

export interface CategoryScore {
  score: number;
  max: 1;
  notes: string;
}

export interface SourceCategories {
  source_title: CategoryScore;
  source_author: CategoryScore;
  central_idea: CategoryScore;
  evidence_cited: CategoryScore;
  analysis_item: CategoryScore;
}

export interface SourceGrade {
  source_label: string;
  score: number;
  max: 5;
  categories: SourceCategories;
}

export interface EvidenceQuality {
  overall: 'strong' | 'okay' | 'weak';
  notes: string[];
}

export interface OrganizerGradeResult {
  total_score: number;
  max_score: 15;
  per_source: SourceGrade[];
  evidence_quality: EvidenceQuality;
  actionable_feedback: string[];
  teacher_note: string;
  feedback_paragraph?: string;
}

export interface GradeOrganizerParams {
  promptText: string;
  studentWorkText: string;
  strictness?: 'stricter' | 'kinder';
}

const SYSTEM_PROMPT = `
You are Bottor Assist, an 8th grade ELA/Social Studies grading assistant.

You are grading a "Graphic Essay Organizer" worth 15 points total.

RUBRIC (15 points total):
Each source is worth 5 points:
1) Source Title (1)
2) Source Author (1)
3) Central idea (1)
4) Evidence (cited) (1)
5) Analysis item (1)

If the organizer uses a specific analysis item (ex: consequence of fascism),
treat that as the analysis category.

SCORING:
1 = present/relevant/accurate
0.5 = present but vague/partly incorrect
0 = missing/off-topic/illegible

Rules:
- Grade ONLY what is present on the organizer.
- If handwriting is unclear, mark "illegible/unclear" and do NOT assume.
- Do NOT invent missing answers.
- Use partial scoring (0.5) when content is vague or partially correct.
- Phrase suggestions as recommendations.
- Return JSON only in the exact schema provided.
`.trim();

function buildUserPrompt(params: GradeOrganizerParams): string {
  const strictnessNote = params.strictness === 'stricter'
    ? '\nBe STRICT: require complete, accurate, and clearly legible responses for full credit.'
    : params.strictness === 'kinder'
    ? '\nBe LENIENT: give partial credit generously when the student shows effort or partial understanding.'
    : '';

  return `
Grade Level: 8
Assignment: Graphic Essay Organizer (3 sources, 15 points)
${strictnessNote}

Teacher Prompt (Analysis Question):
${params.promptText || 'No specific prompt provided. Grade the analysis category based on relevance to the source.'}

Extracted text from the organizer (OCR + any manual corrections):
--- BEGIN STUDENT WORK ---
${params.studentWorkText}
--- END STUDENT WORK ---

Return JSON only in this exact schema:
{
  "total_score": 0,
  "max_score": 15,
  "per_source": [
    {
      "source_label": "Source 1",
      "score": 0,
      "max": 5,
      "categories": {
        "source_title": {"score":0,"max":1,"notes":""},
        "source_author": {"score":0,"max":1,"notes":""},
        "central_idea": {"score":0,"max":1,"notes":""},
        "evidence_cited": {"score":0,"max":1,"notes":""},
        "analysis_item": {"score":0,"max":1,"notes":""}
      }
    },
    {
      "source_label": "Source 2",
      "score": 0,
      "max": 5,
      "categories": {
        "source_title": {"score":0,"max":1,"notes":""},
        "source_author": {"score":0,"max":1,"notes":""},
        "central_idea": {"score":0,"max":1,"notes":""},
        "evidence_cited": {"score":0,"max":1,"notes":""},
        "analysis_item": {"score":0,"max":1,"notes":""}
      }
    },
    {
      "source_label": "Source 3",
      "score": 0,
      "max": 5,
      "categories": {
        "source_title": {"score":0,"max":1,"notes":""},
        "source_author": {"score":0,"max":1,"notes":""},
        "central_idea": {"score":0,"max":1,"notes":""},
        "evidence_cited": {"score":0,"max":1,"notes":""},
        "analysis_item": {"score":0,"max":1,"notes":""}
      }
    }
  ],
  "evidence_quality": {"overall":"strong|okay|weak","notes":[]},
  "actionable_feedback": ["3-6 specific improvement suggestions"],
  "teacher_note": "Note about any illegible sections or missing fields",
  "feedback_paragraph": "A warm, supportive 2-3 sentence feedback for the student"
}
`.trim();
}

export async function gradeGraphicOrganizer(
  params: GradeOrganizerParams
): Promise<OrganizerGradeResult> {
  if (!params.studentWorkText?.trim()) {
    throw new Error('No student work text provided');
  }

  const { data, error } = await supabase.functions.invoke('grade-organizer', {
    body: {
      system_prompt: SYSTEM_PROMPT,
      user_prompt: buildUserPrompt(params),
    },
  });

  if (error) {
    console.error('Grading error:', error);
    throw new Error('Failed to grade organizer');
  }

  return data as OrganizerGradeResult;
}

/**
 * Recalculate total score from edited per_source scores
 */
export function recalculateTotalScore(perSource: SourceGrade[]): number {
  return perSource.reduce((sum, source) => sum + source.score, 0);
}

/**
 * Recalculate source score from its categories
 */
export function recalculateSourceScore(categories: SourceCategories): number {
  return (
    categories.source_title.score +
    categories.source_author.score +
    categories.central_idea.score +
    categories.evidence_cited.score +
    categories.analysis_item.score
  );
}
