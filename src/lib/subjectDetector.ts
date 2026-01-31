/**
 * =============================================================================
 * SUBJECT DETECTOR - Automatic subject detection from rubric content
 * =============================================================================
 * 
 * Detects the academic subject from rubric text using keyword matching.
 * Requires at least 2 keyword matches for confident detection.
 */

export type DetectedSubject = 'Math' | 'Science' | 'ELA' | 'History' | 'General';

export interface SubjectDetectionResult {
  subject: DetectedSubject;
  confidence: 'high' | 'low';
  matchedKeywords: string[];
  matchCount: number;
}

// Keyword definitions for each subject
const SUBJECT_KEYWORDS: Record<DetectedSubject, string[]> = {
  Math: [
    'accuracy', 'calculations', 'work shown', 'problem solving', 'formula',
    'equation', 'computation', 'mathematical', 'arithmetic', 'algebra',
    'geometry', 'numeric', 'solution steps', 'show your work', 'correct answer',
    'partial credit', 'method', 'procedure', 'multiplication', 'division',
    'fraction', 'decimal', 'percent', 'graph', 'coordinate'
  ],
  Science: [
    'hypothesis', 'experiment', 'procedure', 'data', 'conclusion',
    'lab report', 'scientific method', 'observation', 'variables',
    'control group', 'analysis', 'evidence', 'research', 'results',
    'materials', 'investigation', 'prediction', 'theory', 'findings',
    'laboratory', 'specimen', 'measurement'
  ],
  ELA: [
    'ideas', 'organization', 'language', 'conventions', 'grammar',
    'writing', 'voice', 'word choice', 'sentence fluency', 'thesis',
    'introduction', 'conclusion', 'paragraph', 'essay', 'narrative',
    'argument', 'claim', 'evidence', 'citation', 'punctuation',
    'spelling', 'capitalization', 'structure', 'coherence', 'transition',
    'reading comprehension', 'vocabulary', 'literary', 'author', 'text'
  ],
  History: [
    'thesis statement', 'historical evidence', 'primary source', 'analysis',
    'secondary source', 'chronological', 'cause and effect', 'perspective',
    'historical context', 'document', 'interpretation', 'argument',
    'civilization', 'era', 'period', 'event', 'significance', 'impact',
    'social', 'political', 'economic', 'cultural'
  ],
  General: [] // Fallback - no specific keywords
};

/**
 * Detect subject from rubric text
 * @param rubricText - The rubric content to analyze
 * @returns Detection result with subject, confidence, and matched keywords
 */
export function detectSubjectFromRubric(rubricText: string): SubjectDetectionResult {
  if (!rubricText || rubricText.trim().length === 0) {
    return {
      subject: 'General',
      confidence: 'low',
      matchedKeywords: [],
      matchCount: 0
    };
  }

  const lowerText = rubricText.toLowerCase();
  const results: Map<DetectedSubject, string[]> = new Map();

  // Check each subject's keywords
  for (const [subject, keywords] of Object.entries(SUBJECT_KEYWORDS)) {
    if (subject === 'General') continue; // Skip general
    
    const matches: string[] = [];
    for (const keyword of keywords) {
      // Use word boundary matching for more accurate detection
      const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (regex.test(lowerText)) {
        matches.push(keyword);
      }
    }
    
    if (matches.length > 0) {
      results.set(subject as DetectedSubject, matches);
    }
  }

  // Find subject with most matches
  let bestSubject: DetectedSubject = 'General';
  let bestMatches: string[] = [];
  let highestCount = 0;

  for (const [subject, matches] of results.entries()) {
    if (matches.length > highestCount) {
      highestCount = matches.length;
      bestSubject = subject;
      bestMatches = matches;
    }
  }

  // Require at least 2 matches for confident detection
  const isConfident = highestCount >= 2;

  if (!isConfident) {
    return {
      subject: 'General',
      confidence: 'low',
      matchedKeywords: bestMatches,
      matchCount: highestCount
    };
  }

  return {
    subject: bestSubject,
    confidence: highestCount >= 3 ? 'high' : 'low',
    matchedKeywords: bestMatches,
    matchCount: highestCount
  };
}

/**
 * Get grading pipeline type from detected subject
 * Routes to either 'math' or 'ela' pipeline
 */
export function getGradingPipeline(subject: DetectedSubject): 'math' | 'ela' {
  switch (subject) {
    case 'ELA':
      return 'ela';
    case 'Math':
    case 'Science':
    case 'History':
    case 'General':
    default:
      return 'math';
  }
}
