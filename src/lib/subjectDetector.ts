/**
 * =============================================================================
 * SUBJECT DETECTOR
 * =============================================================================
 * 
 * Automatically detects subject from rubric content using keyword matching.
 * Used to route grading to the appropriate pipeline (Math vs ELA).
 * 
 * DETECTION RULES:
 * - Requires at least 2 keyword matches for confident detection
 * - Returns 'General' when confidence is low
 * =============================================================================
 */

import type { ConfidenceScore } from '@/types/submission';

export type DetectedSubject = 'Math' | 'Science' | 'ELA' | 'History' | 'General';

export interface SubjectDetectionResult {
  subject: DetectedSubject;
  confidence: ConfidenceScore;
  matchedKeywords: string[];
  matchCount: number;
}

/**
 * Subject-specific keywords for detection
 */
const SUBJECT_KEYWORDS: Record<DetectedSubject, string[]> = {
  Math: [
    'accuracy', 'calculations', 'work shown', 'problem solving', 
    'formula', 'equation', 'computation', 'mathematical', 
    'arithmetic', 'algebra', 'geometry', 'numbers', 'operations',
    'solve', 'answer', 'solution', 'steps'
  ],
  Science: [
    'hypothesis', 'experiment', 'procedure', 'data', 'conclusion',
    'lab report', 'scientific method', 'observation', 'variables',
    'control', 'results', 'analysis', 'investigation', 'evidence'
  ],
  ELA: [
    'ideas', 'organization', 'language', 'conventions', 'grammar',
    'writing', 'voice', 'word choice', 'sentence fluency', 'thesis',
    'evidence', 'analysis', 'reading', 'comprehension', 'vocabulary',
    'essay', 'paragraph', 'structure', 'content'
  ],
  History: [
    'thesis statement', 'historical evidence', 'primary source',
    'analysis', 'historical context', 'cause and effect', 'timeline',
    'perspective', 'civilization', 'government', 'society'
  ],
  General: [] // Fallback - no specific keywords
};

/**
 * Minimum keyword matches required for confident detection
 */
const MIN_CONFIDENT_MATCHES = 2;

/**
 * Detect subject from rubric text
 * 
 * @param rubricText - The rubric content to analyze
 * @returns Detection result with subject, confidence, and matched keywords
 */
export function detectSubjectFromRubric(rubricText: string): SubjectDetectionResult {
  if (!rubricText?.trim()) {
    return {
      subject: 'General',
      confidence: { value: 0, level: 'low', reason: 'No rubric text provided' },
      matchedKeywords: [],
      matchCount: 0
    };
  }

  const lowerText = rubricText.toLowerCase();
  const results: Array<{ subject: DetectedSubject; keywords: string[]; count: number }> = [];

  // Check each subject's keywords
  for (const [subject, keywords] of Object.entries(SUBJECT_KEYWORDS)) {
    if (subject === 'General') continue;
    
    const matched: string[] = [];
    for (const keyword of keywords) {
      // Use word boundary matching to avoid partial matches
      const regex = new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'i');
      if (regex.test(lowerText)) {
        matched.push(keyword);
      }
    }
    
    if (matched.length > 0) {
      results.push({
        subject: subject as DetectedSubject,
        keywords: matched,
        count: matched.length
      });
    }
  }

  // Sort by match count (descending)
  results.sort((a, b) => b.count - a.count);

  // Return best match if confident
  if (results.length > 0 && results[0].count >= MIN_CONFIDENT_MATCHES) {
    const best = results[0];
    const confidenceValue = Math.min(0.5 + (best.count * 0.15), 0.95);
    
    console.log(`Detected subject: ${best.subject}`);
    console.log(`Matched keywords: ${best.keywords.join(', ')}`);
    console.log(`Confidence: ${(confidenceValue * 100).toFixed(0)}%`);
    
    return {
      subject: best.subject,
      confidence: { 
        value: confidenceValue, 
        level: confidenceValue >= 0.8 ? 'high' : confidenceValue >= 0.5 ? 'medium' : 'low',
        reason: `Matched ${best.count} keywords: ${best.keywords.slice(0, 3).join(', ')}${best.count > 3 ? '...' : ''}`
      },
      matchedKeywords: best.keywords,
      matchCount: best.count
    };
  }

  // Low confidence - return General
  const allMatched = results.flatMap(r => r.keywords);
  console.log('Detected subject: General (low confidence)');
  
  return {
    subject: 'General',
    confidence: { 
      value: results.length > 0 ? 0.3 : 0, 
      level: 'low',
      reason: results.length > 0 
        ? `Only ${allMatched.length} keyword match(es) - need at least ${MIN_CONFIDENT_MATCHES}`
        : 'No subject keywords detected'
    },
    matchedKeywords: allMatched,
    matchCount: allMatched.length
  };
}

/**
 * Get the appropriate grading pipeline based on detected subject
 * 
 * @param subject - The detected subject
 * @returns 'math' or 'ela' pipeline identifier
 */
export function getGradingPipeline(subject: DetectedSubject): 'math' | 'ela' {
  const elaPipeline: DetectedSubject[] = ['ELA', 'History'];
  return elaPipeline.includes(subject) ? 'ela' : 'math';
}

/**
 * Detect subject from answer key text (simpler detection)
 */
export function detectSubjectFromAnswerKey(answerKeyText: string): SubjectDetectionResult {
  if (!answerKeyText?.trim()) {
    return {
      subject: 'General',
      confidence: { value: 0, level: 'low', reason: 'No answer key text provided' },
      matchedKeywords: [],
      matchCount: 0
    };
  }

  // Simple heuristics for answer keys
  const mathIndicators = [
    /^\s*\d+[\.\)]\s*[\d\.\-\+\=\x\/]+/gm,  // Numbered answers with numbers
    /\b(x|y|z)\s*=\s*\d/i,                    // Variable assignments
    /\d+\s*[+\-×÷=]\s*\d+/,                   // Math operations
  ];
  
  const mathMatches = mathIndicators.filter(p => p.test(answerKeyText)).length;
  
  if (mathMatches >= 2) {
    return {
      subject: 'Math',
      confidence: { value: 0.7, level: 'medium', reason: 'Answer key contains mathematical content' },
      matchedKeywords: ['numeric answers', 'equations'],
      matchCount: mathMatches
    };
  }

  // Fall back to general keyword detection
  return detectSubjectFromRubric(answerKeyText);
}
