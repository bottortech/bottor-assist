/**
 * =============================================================================
 * GRADE PAPERS PAGE (/grade) - DEPLOY v2
 * =============================================================================
 *
 * PURPOSE: Upload student work (PDF/image), provide rubric, and generate
 * AI-powered draft grades with feedback.
 *
 * FEATURES:
 * - Rubric: file upload + textarea, combined into rubricTextCombined
 * - Answer Key: file upload + textarea, combined into answerKeyTextCombined
 * - Student Work: auto-groups by filename pattern for batch grading
 * =============================================================================
 */

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useGuestMode } from "@/hooks/useGuestMode";
import { useSavedRubrics } from "@/hooks/useSavedRubrics";
import { useFileUpload, UploadedFileItem } from "@/hooks/useFileUpload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  ArrowLeft,
  Sparkles,
  Copy,
  Download,
  Save,
  Check,
  Loader2,
  Upload,
  FileSearch,
  Info,
  CheckCircle2,
  Printer,
  Lock,
  Unlock,
  X,
  Users,
  FileText,
  ChevronDown,
  BookOpen,
  Lightbulb,
  PenLine,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

import { Switch } from "@/components/ui/switch";
import { FileUploadList } from "@/components/FileUploadList";
import { PilotFeedbackPanel, usePilotFeedback } from "@/components/PilotFeedbackPanel";
import { GroupingReviewModal, analyzeAndGroupFiles, GroupingResult } from "@/components/GroupingReviewModal";
import type { StudentGroupPreview } from "@/components/GroupingReviewModal";
import { 
  ScoringOptionsSection, 
  ScoringMode, 
  AutoScoreSettings, 
  QuickRubricSettings,
  DEFAULT_AUTO_SCORE_SETTINGS, 
  DEFAULT_QUICK_RUBRIC_SETTINGS,
  validateAutoScoreSettings,
  getMaxScoreFromQuickRubric
} from "@/components/ScoringOptionsSection";
import { ELAResultsDisplay } from "@/components/ELAResultsDisplay";
import type { ELAGradeResponse } from "@/types/elaGrading";
// AssignmentTypeSection removed for pilot - Bottor infers feedback style automatically
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { detectSubjectFromRubric, getGradingPipeline, type DetectedSubject, type SubjectDetectionResult } from "@/lib/subjectDetector";

// Subject type for routing to correct grading pipeline
type GradingSubject = "math" | "ela";

// Subject and Grade level lists removed for pilot - Bottor infers from content

// Assignment types moved to optional advanced settings (not shown in pilot)

const RUBRIC_KEYWORDS = [
  "rubric",
  "criteria",
  "points",
  "total",
  "score",
  "each",
  "x3",
  "x2",
  "requirements",
  "grading",
  "evaluation",
  "pts",
  "point value",
  "scoring",
  "/5",
  "/10",
  "/15",
  "/20",
  "/25",
  "/50",
  "/100",
];

/**
 * Parse rubric text to extract scoring metadata
 * Priority: (A) explicit total → (B) sum of item points → (C) infer from structure
 */
interface RubricMeta {
  totalPoints: number | null;
  hasPointValues: boolean;
  pointScaleType: 'total' | 'per-question' | 'by-category' | 'weighted-100' | 'inferred' | 'none';
  rubricItems: Array<{ label: string; pointsPossible: number }>;
  source: 'parsed' | 'inferred' | 'none';
  detectionConfidence: 'high' | 'low' | 'none';
  rawTotalMatch?: string; // For debugging/display
  hasPerformanceLevels?: boolean; // Detected "4 = Excellent" style descriptors
  isWeightedRubric?: boolean; // Category weights sum to 100
}

/**
 * Parse rubric for points using STRICT priority:
 * (A) Look for explicit "Total Points: X" or "Total: X points" patterns FIRST
 * (B) Sum of individual criteria points
 * (C) Infer from answer key question count
 * (D) Infer from student work structure
 * (E) Return null if nothing found - let UI handle fallback
 */
function parseRubricForPoints(rubricText: string, answerKeyText?: string, studentWorkText?: string): RubricMeta {
  if (!rubricText?.trim()) {
    // No rubric - try to infer from answer key or student work
    return inferPointsFromContext(answerKeyText, studentWorkText);
  }

  const items: Array<{ label: string; pointsPossible: number }> = [];
  let explicitTotal: number | null = null;
  let rawTotalMatch: string | undefined;
  let hasPerformanceLevels = false;

  // DETECT PERFORMANCE LEVELS - these are QUALITATIVE DESCRIPTORS, not points
  // Common patterns: "4 = Excellent", "4 - Exceeds", "Level 4:", "Score 4:"
  const performanceLevelPatterns = [
    /[1-5]\s*[=\-–:]\s*(?:excellent|exceeds|proficient|meets|developing|emerging|beginning|unsatisfactory|poor|advanced|mastery|competent|novice)/i,
    /(?:level|score|rating)\s*[1-5]/i,
    /(?:excellent|proficient|developing|beginning)\s*[=\-–:]\s*[1-5]/i,
  ];
  
  for (const pattern of performanceLevelPatterns) {
    if (pattern.test(rubricText)) {
      hasPerformanceLevels = true;
      break;
    }
  }

  // (A) PRIORITY: Look for EXPLICIT total points patterns FIRST
  // These patterns are the most authoritative and should NEVER be guessed
  const explicitTotalPatterns = [
    // "Total Points: 20" or "Total Points = 20"
    /total\s*points?\s*[:=]\s*(\d+)/i,
    // "Total: 20 points" or "Total: 20 pts"
    /total\s*[:=]\s*(\d+)\s*(?:pts?|points?)/i,
    // "(20 points total)" or "20 points total"
    /(\d+)\s*(?:pts?|points?)\s*total/i,
    // "out of 20" or "/20 points"
    /(?:out of|\/)\s*(\d+)\s*(?:pts?|points?)?(?:\s|$)/i,
    // "Maximum: 20 points" or "Max Score: 20"
    /max(?:imum)?\s*(?:score|points?)?\s*[:=]?\s*(\d+)/i,
    // "__/20" scoring format often in rubrics
    /__\/(\d+)/,
  ];

  for (const pattern of explicitTotalPatterns) {
    const match = rubricText.match(pattern);
    if (match) {
      const val = parseInt(match[1], 10);
      if (val > 0 && val <= 1000) {
        explicitTotal = val;
        rawTotalMatch = match[0];
        break;
      }
    }
  }

  // (B) Parse individual criteria/items with EXPLICIT CATEGORY WEIGHTS
  // Patterns: "Accuracy – 40 points", "Work Shown (30 pts)", "Clarity: 20 points"
  // IMPORTANT: These are category point weights, NOT performance levels
  const categoryPatterns = [
    /([A-Za-z][A-Za-z\s\/\-–]+?)(?:[\-–:]|\s*[\(\[])\s*(\d+)\s*(?:pts?|points?)(?:[\)\]])?/g,
    /(\d+)\s*(?:pts?|points?)\s*[-:–]\s*([A-Za-z][A-Za-z\s\/\-]+)/g,
    /([A-Za-z][A-Za-z\s\/\-]+?)\s*[-–]\s*(\d+)\s*(?:pts?|points?)?/g,
  ];

  for (const pattern of categoryPatterns) {
    let match;
    while ((match = pattern.exec(rubricText)) !== null) {
      let label: string;
      let points: number;
      
      // Check if points come first or label comes first
      if (/^\d+$/.test(match[1])) {
        points = parseInt(match[1], 10);
        label = match[2]?.trim() || '';
      } else {
        label = match[1]?.trim() || '';
        points = parseInt(match[2], 10);
      }
      
      // Validate - exclude common false positives
      const lowerLabel = label.toLowerCase();
      const isExcluded = ['total', 'maximum', 'max', 'out of', 'score', 'level', 'rating'].some(
        ex => lowerLabel === ex || lowerLabel.startsWith(ex + ' ')
      );
      
      // When performance levels are detected, require higher point values to be category weights
      // (Small numbers like 1-5 are likely performance levels, not category weights)
      const minPoints = hasPerformanceLevels ? 10 : 1;
      
      if (!isExcluded && label.length > 2 && label.length < 60 && points >= minPoints && points <= 100) {
        // Avoid duplicates
        if (!items.some(i => i.label.toLowerCase() === label.toLowerCase())) {
          items.push({ label, pointsPossible: points });
        }
      }
    }
  }

  // Calculate sum of items
  const sumOfItems = items.reduce((sum, item) => sum + item.pointsPossible, 0);

  // Determine final total and type using priority rules
  let totalPoints: number | null = null;
  let pointScaleType: RubricMeta['pointScaleType'] = 'none';
  let hasPointValues = false;
  let detectionConfidence: RubricMeta['detectionConfidence'] = 'none';
  let isWeightedRubric = false;

  // SAFEGUARD: Common performance level counts that should NEVER be used as totalPoints
  // when explicit category weights exist
  const performanceLevelCounts = [3, 4, 5, 6];
  const hasCategoryWeights = items.length >= 2 && sumOfItems >= 10;

  // Check if this is a weighted 100-point rubric
  if (sumOfItems === 100 && items.length >= 2) {
    // Category weights sum to exactly 100 - this is a weighted rubric
    totalPoints = 100;
    hasPointValues = true;
    pointScaleType = 'weighted-100';
    detectionConfidence = 'high';
    isWeightedRubric = true;
  }
  // PRIORITY A: Explicit total - but SAFEGUARD against performance level counts
  else if (explicitTotal && explicitTotal > 0) {
    // SAFEGUARD: If explicit total matches a performance level count (3-6) 
    // AND we have category weights, prefer sumOfItems
    if (hasPerformanceLevels && hasCategoryWeights && performanceLevelCounts.includes(explicitTotal)) {
      // Explicit total looks like a performance level count - use category sum instead
      totalPoints = sumOfItems;
      hasPointValues = true;
      pointScaleType = items.length > 1 ? 'by-category' : 'per-question';
      detectionConfidence = 'high';
      isWeightedRubric = sumOfItems === 100;
    } else {
      totalPoints = explicitTotal;
      hasPointValues = true;
      pointScaleType = 'total';
      detectionConfidence = 'high';
    }
  } 
  // PRIORITY B: Sum of item points as second choice
  else if (sumOfItems > 0) {
    totalPoints = sumOfItems;
    hasPointValues = true;
    pointScaleType = items.length > 1 ? 'by-category' : 'per-question';
    // Higher confidence if sum is reasonable for a multi-item rubric
    detectionConfidence = sumOfItems >= 10 || items.length <= 2 ? 'high' : 'low';
    isWeightedRubric = sumOfItems === 100;
  }
  // PRIORITY C/D: Try inference
  else {
    const inferred = inferPointsFromContext(answerKeyText, studentWorkText);
    if (inferred.totalPoints) {
      return {
        ...inferred,
        source: 'inferred',
        detectionConfidence: 'low',
        hasPerformanceLevels,
      };
    }
    // Return null total - UI will prompt for manual input
    return {
      totalPoints: null,
      hasPointValues: false,
      pointScaleType: 'none',
      rubricItems: [],
      source: 'none',
      detectionConfidence: 'none',
      hasPerformanceLevels,
    };
  }

  return {
    totalPoints,
    hasPointValues,
    pointScaleType,
    rubricItems: items,
    source: 'parsed',
    detectionConfidence,
    rawTotalMatch,
    hasPerformanceLevels,
    isWeightedRubric,
  };
}

/**
 * Infer points from answer key or student work when no rubric
 */
function inferPointsFromContext(answerKeyText?: string, studentWorkText?: string): RubricMeta {
  // (C) Count questions in answer key
  if (answerKeyText?.trim()) {
    const questionPatterns = [
      /^\s*\d+[\.\)]/gm,  // "1." or "1)"
      /^[A-Z][\.\)]/gm,   // "A." or "A)"
      /question\s*\d+/gi,
    ];
    
    let maxCount = 0;
    for (const pattern of questionPatterns) {
      const matches = answerKeyText.match(pattern);
      if (matches && matches.length > maxCount) {
        maxCount = matches.length;
      }
    }
    
    if (maxCount > 0) {
      return {
        totalPoints: maxCount, // 1 point per question default
        hasPointValues: false,
        pointScaleType: 'per-question',
        rubricItems: [],
        source: 'inferred',
        detectionConfidence: 'low',
      };
    }
  }

  // (D) Count questions in student work
  if (studentWorkText?.trim()) {
    const questionPatterns = [
      /^\s*\d+[\.\)]/gm,
      /^[A-Z][\.\)]/gm,
    ];
    
    let maxCount = 0;
    for (const pattern of questionPatterns) {
      const matches = studentWorkText.match(pattern);
      if (matches && matches.length > maxCount) {
        maxCount = matches.length;
      }
    }
    
    if (maxCount > 0) {
      return {
        totalPoints: maxCount,
        hasPointValues: false,
        pointScaleType: 'inferred',
        rubricItems: [],
        source: 'inferred',
        detectionConfidence: 'low',
      };
    }
  }

  // No points could be determined - return null (UI will prompt)
  return {
    totalPoints: null,
    hasPointValues: false,
    pointScaleType: 'none',
    rubricItems: [],
    source: 'none',
    detectionConfidence: 'none',
  };
}

/**
 * Detect if uploaded file or text contains an answer key
 */
function detectAnswerKey(filename: string, text: string): boolean {
  const lowerFilename = filename.toLowerCase();
  const lowerText = text.toLowerCase();
  
  // Check filename
  if (lowerFilename.includes('answer') && lowerFilename.includes('key')) return true;
  if (lowerFilename.includes('answerkey')) return true;
  if (lowerFilename.includes('answer_key')) return true;
  if (lowerFilename.includes('solutions')) return true;
  
  // Check text content (first 500 chars)
  const preview = lowerText.slice(0, 500);
  if (preview.includes('answer key')) return true;
  if (preview.includes('answer sheet')) return true;
  if (preview.includes('solutions')) return true;
  if (preview.includes('correct answers')) return true;
  
  return false;
}

interface GradePapersForm {
  grade_level: string;
  subject: string;
  assignment_type: string;
  rubric: string;
  answer_key: string;
}

interface GradingResult {
  score_suggestion: string;
  score_derivation?: string;
  score_percent?: number;
  letter_grade?: string;
  confidence?: 'high' | 'medium' | 'low';
  rubric_source?: 'teacher' | 'auto-generated';
  strengths: string;
  areas_for_improvement: string;
  feedback_paragraph: string;
}

interface StudentGroup {
  studentName: string;
  detectedName: string; // Original detected name (for display)
  nameSource: 'document' | 'filename' | 'unknown'; // How the name was detected
  nameConfidence: 'high' | 'low'; // Confidence in the detected name
  nameConfirmed: boolean; // Teacher has confirmed/edited the name
  files: UploadedFileItem[];
  extractedText: string;
  result: GradingResult | null;
  grading: boolean;
}

type GradingMode = "scoring" | "feedback-only";
type RubricMode = "none" | "draft" | "locked";
// ScoringMode is now imported from ScoringOptionsSection

/**
 * Stop-word labels that should NOT be part of a student name
 * These commonly appear after names on worksheets
 */
const NAME_STOP_WORDS = [
  'date', 'name', 'student', 'grade', 'class', 'period', 
  'teacher', 'id', 'score', 'points', 'page', 'section',
  'assignment', 'subject', 'course', 'hour', 'block', 'room',
  'number', 'no', 'total', 'time', 'due'
];

/**
 * Metadata line prefixes - lines starting with these should be skipped entirely
 */
const METADATA_LINE_PREFIXES = [
  'date', 'class', 'period', 'teacher', 'grade', 'subject',
  'assignment', 'course', 'hour', 'block', 'room', 'score',
  'points', 'total', 'page', 'section', 'id', 'number', 'due'
];

/**
 * Assignment title keywords - text containing these is NOT a student name
 * These answer "WHAT is this about?" not "WHO wrote this?"
 */
const ASSIGNMENT_TITLE_KEYWORDS = [
  // Subject names
  'english', 'math', 'mathematics', 'science', 'history', 'reading', 'writing',
  'algebra', 'geometry', 'biology', 'chemistry', 'physics', 'geography',
  'literature', 'spelling', 'vocabulary', 'grammar', 'social studies',
  // Assignment types
  'essay', 'test', 'quiz', 'exam', 'report', 'review', 'worksheet',
  'homework', 'classwork', 'project', 'lab', 'exercise', 'practice',
  'assessment', 'evaluation', 'final', 'midterm', 'chapter', 'unit',
  'lesson', 'activity', 'journal', 'reflection', 'response', 'analysis',
  // Document indicators
  'page', 'part', 'section', 'directions', 'instructions', 'rubric',
  // Generic headers
  'book', 'persuasive', 'narrative', 'argumentative', 'expository',
  'creative', 'research', 'summary', 'outline', 'draft', 'revision'
];

/**
 * LOCATION-BASED NAME DETECTION
 * 
 * Philosophy: Names appear at the VERY TOP of pages in specific header areas.
 * Essay content appears in the body. We detect based on LOCATION, not content.
 * 
 * NAME LOCATIONS (✓):
 * - First 1-3 lines of text (header area)
 * - Lines with explicit "Name:" or "Student:" labels
 * - Typically right-aligned or standalone at top
 * 
 * BODY/ESSAY LOCATIONS (✗):
 * - Lines 4+ (essay body starts)
 * - Text that flows as paragraphs
 * - Continuation text without header formatting
 */

// Maximum lines to check for name (header area only)
const NAME_DETECTION_LINE_LIMIT = 5;

/**
 * Check if a line looks like it's in "header format" vs "body text"
 * Header lines are typically short, may have labels, and don't flow as paragraphs
 */
function isHeaderLine(line: string): boolean {
  if (!line) return false;
  const trimmed = line.trim();
  
  // Short lines are more likely to be headers (name fields are usually short)
  if (trimmed.length < 40) return true;
  
  // Lines with explicit name labels are header lines
  if (/^(name|student|by)\s*[:=]/i.test(trimmed)) return true;
  
  // Lines that look like metadata/header format
  if (/^(date|class|period|grade|teacher)\s*[:=]/i.test(trimmed)) return true;
  
  // Long flowing text is body content, not headers
  if (trimmed.length > 60 && !trimmed.includes(':')) return false;
  
  return true;
}

/**
 * Check if line appears to be body/essay content based on structure
 * Body content is typically longer, flows as sentences, and lacks header formatting
 */
function isBodyContent(line: string, lineIndex: number): boolean {
  if (!line) return false;
  const trimmed = line.trim();
  
  // Lines after the header area (line 5+) are body content
  if (lineIndex >= NAME_DETECTION_LINE_LIMIT) return true;
  
  // Long lines without labels are likely body text
  if (trimmed.length > 50 && !/:/.test(trimmed)) return true;
  
  // Lines that look like sentences (start with lowercase after first word, have punctuation)
  if (/^[A-Z][a-z]+\s+[a-z]/.test(trimmed) && /[,.!?]/.test(trimmed)) return true;
  
  return false;
}

/**
 * Check if text looks like an assignment title rather than a student name
 * @returns true if text is an assignment title (NOT a name)
 */
function isAssignmentTitle(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  
  // Check for assignment keywords
  for (const keyword of ASSIGNMENT_TITLE_KEYWORDS) {
    if (lower.includes(keyword)) return true;
  }
  
  // Check for numbered patterns like "Chapter 5", "Unit 3", "Page 1"
  if (/\b(chapter|unit|page|part|section|lesson)\s*\d+/i.test(text)) return true;
  
  // Check for grade level patterns like "5th Grade", "Grade 5"
  if (/\b(grade|gr\.?)\s*\d+|(\d+)(st|nd|rd|th)\s*grade/i.test(text)) return true;
  
  return false;
}

/**
 * Clean a detected name by removing trailing stop-word labels
 * Allows apostrophes and hyphens as valid name characters (e.g., O'Connor, Mary-Jane, D'Andre)
 * @returns cleaned name and confidence level
 */
function cleanStudentName(rawName: string): { name: string; confidence: 'high' | 'low' } {
  if (!rawName) return { name: '', confidence: 'low' };
  
  const words = rawName.trim().split(/\s+/);
  const cleanedWords: string[] = [];
  let hitStopWord = false;
  let hasMergedMetadata = false;
  
  for (const word of words) {
    // Extract only letters for stop-word comparison (ignore apostrophes/hyphens)
    const lowerWord = word.toLowerCase().replace(/[^a-z]/g, '');
    // Stop if we hit a stop-word label
    if (NAME_STOP_WORDS.includes(lowerWord)) {
      hitStopWord = true;
      break;
    }
    // Check if word contains numbers or unusual punctuation (indicates merged metadata)
    if (/\d/.test(word) || /[^a-zA-Z''\-\s]/.test(word)) {
      hasMergedMetadata = true;
      break;
    }
    // Keep words that have letters - allow apostrophes and hyphens as valid name chars
    if (word.replace(/[^a-zA-Z''\-]/g, '').length > 0) {
      cleanedWords.push(word);
    }
  }
  
  // Validate: must be 2-4 words
  if (cleanedWords.length < 2 || cleanedWords.length > 4) {
    return { name: rawName.trim(), confidence: 'low' };
  }
  
  // Check if all words are properly capitalized
  // Allow: "O'Connor", "D'Andre", "Mary-Jane", "Ana María-Lopez"
  const allCapitalized = cleanedWords.every(w => {
    // First letter should be uppercase
    if (!/^[A-Z]/.test(w)) return false;
    // For names with apostrophe followed by capital (O'Connor, D'Andre), that's valid
    // For hyphenated names, each part should start with capital (Mary-Jane)
    return true;
  });
  
  const cleanedName = cleanedWords.join(' ');
  
  // Low confidence only if:
  // - We had to remove stop words (name was merged with metadata)
  // - Name has merged metadata (numbers, unusual punctuation)
  // - Not all words are properly capitalized
  // NOTE: Apostrophes and hyphens are VALID name characters and do NOT lower confidence
  const confidence: 'high' | 'low' = (hitStopWord || hasMergedMetadata || !allCapitalized) ? 'low' : 'high';
  
  return { name: cleanedName, confidence };
}

/**
 * Check if a line is a metadata line that should be skipped
 */
function isMetadataLine(line: string): boolean {
  const trimmed = line.trim().toLowerCase();
  // Skip empty lines
  if (!trimmed) return true;
  // Check if line starts with a metadata prefix
  return METADATA_LINE_PREFIXES.some(prefix => 
    trimmed.startsWith(prefix + ':') || 
    trimmed.startsWith(prefix + ' ') ||
    trimmed === prefix
  );
}

/**
 * Extract the name value after a label like "Name:" or "Student Name:"
 * Stops at any metadata label that follows
 */
function extractNameAfterLabel(text: string): string | null {
  // Match "Name:" or "Student Name:" followed by the value
  const labelMatch = text.match(/(?:student\s*)?name\s*[:=]\s*(.+)/i);
  if (!labelMatch) return null;
  
  let nameValue = labelMatch[1].trim();
  
  // Stop at any metadata label that might follow on the same line
  // e.g., "John Smith Date: 10/15" -> "John Smith"
  for (const stopWord of NAME_STOP_WORDS) {
    // Match stop word followed by colon, equals, or as standalone word boundary
    const stopPattern = new RegExp(`\\b${stopWord}\\s*[:=]`, 'i');
    const stopMatch = nameValue.match(stopPattern);
    if (stopMatch && stopMatch.index !== undefined) {
      nameValue = nameValue.substring(0, stopMatch.index).trim();
    }
  }
  
  return nameValue || null;
}

/**
 * Detect student name from extracted document text (OCR)
 * Priority: Explicit labels (Name:, Student Name:) > Pattern matching
 * 
 * DETECTION PHILOSOPHY:
 * - A student name answers "WHO wrote this?" not "WHAT is this about?"
 * - Names are personal identifiers (2-4 words, typically capitalized)
 * - Names usually appear at TOP of pages (first third of document)
 * - Assignment titles, subject names, and headers are NOT student names
 */
function detectStudentNameFromText(text: string): { 
  name: string; 
  source: 'document' | 'unknown';
  confidence: 'high' | 'low';
} {
  if (!text || !text.trim()) {
    return { name: '', source: 'unknown', confidence: 'low' };
  }

  // LOCATION-BASED: Only look at first few lines (header area) for names
  // Names appear at TOP of pages, not in body content
  const allLines = text.split('\n');
  const headerLines = allLines.slice(0, NAME_DETECTION_LINE_LIMIT);
  
  // Filter out metadata lines from header
  const relevantHeaderLines: string[] = [];
  for (let i = 0; i < headerLines.length; i++) {
    const line = headerLines[i];
    if (!isMetadataLine(line) && isHeaderLine(line)) {
      relevantHeaderLines.push(line);
    }
  }

  // First priority: Look for explicit "Name:" or "Student Name:" labels in header area
  for (let i = 0; i < headerLines.length; i++) {
    const line = headerLines[i];
    const nameValue = extractNameAfterLabel(line);
    if (nameValue) {
      // Check if this is an assignment title (not a name)
      if (isAssignmentTitle(nameValue)) {
        continue;
      }
      
      const { name: cleanedName, confidence } = cleanStudentName(nameValue);
      const words = cleanedName.split(/\s+/);
      if (words.length >= 2 && words.length <= 4 && cleanedName.length >= 3 && cleanedName.length <= 50) {
        return { name: cleanedName, source: 'document', confidence };
      }
    }
  }

  // Second priority: Look for name at start of first header line
  // CRITICAL: Only check header-formatted lines, not body content
  const firstHeaderLine = relevantHeaderLines.find(l => l.trim().length > 0);
  if (firstHeaderLine && !isBodyContent(firstHeaderLine, 0)) {
    // Skip if first line looks like an assignment title
    if (!isAssignmentTitle(firstHeaderLine)) {
      // Name pattern: Capitalized words (allow apostrophes/hyphens like O'Connor, Mary-Jane)
      const startMatch = firstHeaderLine.match(/^([A-Z][a-z'-]*\s+[A-Z][a-z'-]*(?:\s+[A-Z][a-z'-]*)?)(?:\s|$)/);
      if (startMatch && startMatch[1]) {
        const potentialName = startMatch[1];
        // Double-check this isn't a title
        if (!isAssignmentTitle(potentialName)) {
          const { name: cleanedName, confidence } = cleanStudentName(potentialName);
          const words = cleanedName.split(/\s+/);
          if (words.length >= 2 && words.length <= 4) {
            return { name: cleanedName, source: 'document', confidence };
          }
        }
      }
    }
  }

  // Third priority: Look for "By: Name" or "Student: Name" patterns in header area only
  const headerText = relevantHeaderLines.join('\n');
  const byPatterns = [
    /student\s*[:=]\s*([A-Za-z][a-z'-]*(?:\s+[A-Za-z][a-z'-]*)+)/i,
    /by\s*[:=]?\s*([A-Za-z][a-z'-]*(?:\s+[A-Za-z][a-z'-]*)+)/i,
  ];
  
  for (const pattern of byPatterns) {
    const match = headerText.match(pattern);
    if (match && match[1]) {
      const potentialName = match[1].trim();
      // Skip if this looks like an assignment title
      if (isAssignmentTitle(potentialName)) {
        continue;
      }
      
      const { name: cleanedName, confidence } = cleanStudentName(potentialName);
      const words = cleanedName.split(/\s+/);
      if (words.length >= 2 && words.length <= 4 && cleanedName.length >= 3 && cleanedName.length <= 50) {
        return { name: cleanedName, source: 'document', confidence };
      }
    }
  }

  // No name found in header area - this is likely a continuation page
  return { name: '', source: 'unknown', confidence: 'low' };
}

/**
 * Parse student name from filename (fallback)
 * Patterns:
 *  - Lesson4_Functions__AaliyahJohnson__p1.pdf → "Aaliyah Johnson"
 *  - AaliyahJohnson_Assignment.pdf → "Aaliyah Johnson"
 */
function parseStudentNameFromFilename(filename: string): { name: string; found: boolean } {
  const nameWithoutExt = filename.replace(/\.[^/.]+$/, "");

  // Pattern 1: Double underscore format
  const doubleUnderscoreMatch = nameWithoutExt.match(/__([^_]+)__/);
  if (doubleUnderscoreMatch) {
    return { name: formatStudentName(doubleUnderscoreMatch[1]), found: true };
  }

  // Pattern 2: CamelCase/PascalCase
  const camelCaseMatch = nameWithoutExt.match(/([A-Z][a-z]+[A-Z][a-z]+)/);
  if (camelCaseMatch) {
    return { name: formatStudentName(camelCaseMatch[1]), found: true };
  }

  // Pattern 3: Underscore separated (first two parts)
  // Note: Don't split on hyphens in filenames as they may be part of names (Mary-Jane)
  const parts = nameWithoutExt.split(/[_\s]+/);
  if (parts.length >= 2) {
    const firstTwo = parts.slice(0, 2).join(" ");
    // Allow apostrophes and hyphens in names
    if (/^[A-Za-z'-]+ [A-Za-z'-]+$/.test(firstTwo)) {
      return { name: firstTwo, found: true };
    }
  }

  return { name: '', found: false };
}

/**
 * Format camelCase/PascalCase to "First Last"
 */
function formatStudentName(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim();
}

/**
 * Group files by detected student name
 * Priority: Document OCR > Filename > Unknown
 */
function groupFilesByStudent(files: UploadedFileItem[]): StudentGroup[] {
  const groups: StudentGroup[] = [];

  for (const file of files) {
    // Try document text first
    const docResult = detectStudentNameFromText(file.extractedText);
    let studentName = docResult.name;
    let nameSource: 'document' | 'filename' | 'unknown' = docResult.source;
    let nameConfidence: 'high' | 'low' = docResult.confidence;

    // Fallback to filename
    if (!studentName) {
      const fileResult = parseStudentNameFromFilename(file.fileName);
      if (fileResult.found) {
        studentName = fileResult.name;
        nameSource = 'filename';
        // Filename-based detection is lower confidence
        nameConfidence = 'low';
      }
    }

    // Still no name
    if (!studentName) {
      studentName = 'Unknown Student';
      nameSource = 'unknown';
      nameConfidence = 'low';
    }

    // Find existing group or create new
    const existingGroup = groups.find(g => g.studentName === studentName);
    if (existingGroup) {
      existingGroup.files.push(file);
      existingGroup.extractedText = existingGroup.files
        .map(f => f.extractedText)
        .join('\n\n--- PAGE BREAK ---\n\n');
    } else {
      groups.push({
        studentName,
        detectedName: studentName,
        nameSource,
        nameConfidence,
        // Auto-confirm only if from document with high confidence
        nameConfirmed: nameSource === 'document' && nameConfidence === 'high',
        files: [file],
        extractedText: file.extractedText,
        result: null,
        grading: false,
      });
    }
  }

  return groups;
}

export default function GradePapers() {
  const { user, loading: authLoading } = useAuth();
  const { isGuest } = useGuestMode();
  const navigate = useNavigate();
  const { toast } = useToast();

  // File input refs
  const studentFileInputRef = useRef<HTMLInputElement>(null);
  const rubricFileInputRef = useRef<HTMLInputElement>(null);
  const answerKeyFileInputRef = useRef<HTMLInputElement>(null);

  const { rubrics: savedRubrics, saveRubric, markRubricAsUsed } = useSavedRubrics();

  // File upload hooks for each section
  const studentUpload = useFileUpload({ maxConcurrentExtractions: 2, maxDimension: 1600 });
  const rubricUpload = useFileUpload({ maxConcurrentExtractions: 2, maxDimension: 1600 });
  const answerKeyUpload = useFileUpload({ maxConcurrentExtractions: 2, maxDimension: 1600 });

  const [form, setForm] = useState<GradePapersForm>({
    grade_level: "",
    subject: "",
    assignment_type: "",
    rubric: "",
    answer_key: "",
  });

  const [gradingMode, setGradingMode] = useState<GradingMode>("scoring");
  const [rubricMode, setRubricMode] = useState<RubricMode>("none");
  const [rubricLocked, setRubricLocked] = useState(false);
  const [detectedRubricSource, setDetectedRubricSource] = useState("");

  // Auto-detected subject state (replaces manual selection)
  const [detectedSubjectResult, setDetectedSubjectResult] = useState<SubjectDetectionResult | null>(null);
  const gradingSubject: GradingSubject = detectedSubjectResult 
    ? getGradingPipeline(detectedSubjectResult.subject) 
    : "math";
  
  // ELA-specific state
  const [elaRubricText, setElaRubricText] = useState("");
  const [elaRubricSource, setElaRubricSource] = useState<"paste" | "file">("paste");
  const [elaRubricFileName, setElaRubricFileName] = useState<string | null>(null);
  const [elaRubricFileLoading, setElaRubricFileLoading] = useState(false);
  const [elaRubricTipsOpen, setElaRubricTipsOpen] = useState(false);
  const [elaResults, setElaResults] = useState<Map<string, ELAGradeResponse>>(new Map());
  const elaRubricFileInputRef = useRef<HTMLInputElement>(null);

  // Grading Criteria accordion state (collapsed by default)
  const [gradingCriteriaOpen, setGradingCriteriaOpen] = useState(false);

  // Manual total points override (when auto-detection fails or user wants to change)
  const [manualTotalPoints, setManualTotalPoints] = useState<number | null>(null);
  
  // Answer key detection state
  const [answerKeyDetected, setAnswerKeyDetected] = useState(false);
  
  // Rubric detection state (tracks if rubric content exists)
  const rubricDetected = useMemo(() => {
    const hasRubricFile = rubricUpload.files.some(f => f.status === 'ready');
    const hasRubricText = form.rubric.trim().length > 0;
    const hasRubricFromExtraction = rubricUpload.files.some(f => 
      f.status === 'ready' && f.extractedText && f.extractedText.trim().length > 0
    );
    return hasRubricFile || hasRubricText || hasRubricFromExtraction;
  }, [rubricUpload.files, form.rubric]);

  // Scoring options state (assignment type removed for pilot)
  const [scoringMode, setScoringMode] = useState<ScoringMode>("feedback-only"); // Default to feedback-only
  const [autoScoreSettings, setAutoScoreSettings] = useState<AutoScoreSettings>(DEFAULT_AUTO_SCORE_SETTINGS);
  const [quickRubricSettings, setQuickRubricSettings] = useState<QuickRubricSettings>(DEFAULT_QUICK_RUBRIC_SETTINGS);
  
  // Check if rubric or answer key is provided (file with Ready status OR text entered)
  // This determines button label and grading intent - reacts immediately to file status changes
  const hasGradingCriteria = useMemo(() => {
    const hasRubricFile = rubricUpload.files.some(f => f.status === 'ready');
    const hasRubricText = form.rubric.trim().length > 0;
    const hasAnswerKeyFile = answerKeyUpload.files.some(f => f.status === 'ready');
    const hasAnswerKeyText = form.answer_key.trim().length > 0;
    return hasRubricFile || hasRubricText || hasAnswerKeyFile || hasAnswerKeyText;
  }, [rubricUpload.files, form.rubric, answerKeyUpload.files, form.answer_key]);
  
  // Determine if scoring is enabled (rubric/answer key present OR manual scoring rules configured)
  const hasScoringEnabled = useMemo(() => {
    if (scoringMode === 'feedback-only') return false;
    if (rubricMode !== 'none') return true; // Has rubric
    if (hasGradingCriteria) return true; // Has answer key or rubric content
    if (scoringMode === 'auto-score') {
      return validateAutoScoreSettings(autoScoreSettings);
    }
    if (scoringMode === 'rubric-based') {
      return quickRubricSettings.enabled 
        ? quickRubricSettings.categories.length > 0 
        : quickRubricSettings.totalPoints !== null;
    }
    return false;
  }, [scoringMode, rubricMode, hasGradingCriteria, autoScoreSettings, quickRubricSettings]);

  // Student groups for batch grading
  const [studentGroups, setStudentGroups] = useState<StudentGroup[]>([]);
  const [selectedGroupIndex, setSelectedGroupIndex] = useState(0);
  
  // Grouping review modal state (for multi-page safety)
  const [groupingReviewOpen, setGroupingReviewOpen] = useState(false);
  const [groupingResult, setGroupingResult] = useState<GroupingResult | null>(null);
  const [pendingGroupsForReview, setPendingGroupsForReview] = useState<StudentGroupPreview[]>([]);
  
  // Inline name editing state
  const [editingNameIndex, setEditingNameIndex] = useState<number | null>(null);
  const [editingNameValue, setEditingNameValue] = useState("");

  const [grading, setGrading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  
  // Feedback expansion state - collapsed by default for calm UX
  const [feedbackExpanded, setFeedbackExpanded] = useState(false);

  // Track if grading has completed for any student (for feedback timing)
  const hasGradingResults = studentGroups.some(g => g.result !== null);
  
  // Pilot feedback panel with smart timing (scroll or timeout)
  const { showFeedback, dismissFeedback, skipFeedback } = usePilotFeedback(isGuest, hasGradingResults);

  // Extract just the text content from uploaded rubric files (excluding status placeholders)
  const rubricExtractedText = useMemo(() => {
    const readyFiles = rubricUpload.files.filter(f => f.status === 'ready');
    const textParts = readyFiles
      .map(f => f.extractedText?.trim())
      .filter(Boolean);
    return textParts.join('\n\n');
  }, [rubricUpload.files]);

  // Combined text from files + manual textarea
  const rubricFinalText = useMemo(() => {
    return [rubricExtractedText, form.rubric.trim()].filter(Boolean).join('\n\n');
  }, [rubricExtractedText, form.rubric]);

  // Legacy alias for backward compatibility
  const rubricTextCombined = useMemo(() => {
    const parts: string[] = [];
    if (rubricExtractedText) {
      parts.push("--- From Uploaded Files ---\n" + rubricExtractedText);
    }
    if (form.rubric.trim()) {
      parts.push("--- From Manual Entry ---\n" + form.rubric);
    }
    return parts.join("\n\n");
  }, [rubricExtractedText, form.rubric]);

  // Extract just the text content from uploaded answer key files
  const answerKeyExtractedText = useMemo(() => {
    const readyFiles = answerKeyUpload.files.filter(f => f.status === 'ready');
    const textParts = readyFiles
      .map(f => f.extractedText?.trim())
      .filter(Boolean);
    return textParts.join('\n\n');
  }, [answerKeyUpload.files]);

  const answerKeyTextCombined = useMemo(() => {
    const parts: string[] = [];
    if (answerKeyExtractedText) {
      parts.push("--- From Uploaded Files ---\n" + answerKeyExtractedText);
    }
    if (form.answer_key.trim()) {
      parts.push("--- From Manual Entry ---\n" + form.answer_key);
    }
    return parts.join("\n\n");
  }, [answerKeyExtractedText, form.answer_key]);

  // Warning: Rubric file uploaded but no text extracted
  const rubricExtractionWarning = useMemo(() => {
    const hasRubricFiles = rubricUpload.files.some(f => f.status === 'ready');
    const hasExtractedText = rubricExtractedText.trim().length > 0;
    return hasRubricFiles && !hasExtractedText;
  }, [rubricUpload.files, rubricExtractedText]);

  // Parse rubric to extract scoring metadata (points, categories, etc.)
  // Uses priority: (A) parsed total → (B) sum of items → (C) answer key → (D) student work
  const parsedRubricMeta = useMemo((): RubricMeta => {
    // Get student work text for inference fallback
    const studentWorkText = studentGroups.length > 0 
      ? studentGroups.map(g => g.extractedText).join('\n\n')
      : studentUpload.combinedText;
    
    return parseRubricForPoints(rubricFinalText, answerKeyTextCombined, studentWorkText);
  }, [rubricFinalText, answerKeyTextCombined, studentGroups, studentUpload.combinedText]);

  // Effective total points: manual override > parsed > default to 20 (never null when rubric detected)
  const effectiveTotalPoints = useMemo(() => {
    if (manualTotalPoints && manualTotalPoints > 0) return manualTotalPoints;
    if (parsedRubricMeta.totalPoints) return parsedRubricMeta.totalPoints;
    // Default to 20 when rubric is detected but points couldn't be parsed
    // This prevents blocking the grading flow
    if (rubricDetected) return 20;
    return null;
  }, [manualTotalPoints, parsedRubricMeta.totalPoints, rubricDetected]);
  
  // Track if total points were inferred vs parsed
  const totalPointsInferred = useMemo(() => {
    if (manualTotalPoints && manualTotalPoints > 0) return false;
    if (parsedRubricMeta.totalPoints) return false;
    return rubricDetected; // Inferred when rubric exists but no points found
  }, [manualTotalPoints, parsedRubricMeta.totalPoints, rubricDetected]);

  // Determine if scoring is valid based on parsed rubric or manual settings
  // UPDATED: Never block with errors when rubric is detected - default to 20 points
  const scoringValidation = useMemo(() => {
    // Helper to build appropriate badge message based on rubric type
    const buildBadgeMessage = (total: number, isManual: boolean, isInferred: boolean) => {
      if (isManual) {
        return `Rubric locked — scoring enabled (Total: ${total} points, manually set)`;
      }
      if (parsedRubricMeta.isWeightedRubric) {
        return `Weighted rubric detected — Total: ${total} points`;
      }
      if (parsedRubricMeta.pointScaleType === 'weighted-100') {
        return `Weighted rubric detected — Total: ${total} points`;
      }
      if (isInferred) {
        return `Rubric locked — total points inferred as ${total} (editable below)`;
      }
      return `Rubric locked — scoring enabled (Total: ${total} points)`;
    };

    // If rubric is locked with effective total points, scoring is valid
    if (rubricLocked && effectiveTotalPoints) {
      const isManualOverride = manualTotalPoints && manualTotalPoints > 0;
      
      return { 
        isValid: true, 
        totalPoints: effectiveTotalPoints,
        source: isManualOverride ? 'manual' as const : parsedRubricMeta.source,
        confidence: isManualOverride ? 'high' as const : parsedRubricMeta.detectionConfidence,
        message: buildBadgeMessage(effectiveTotalPoints, isManualOverride, totalPointsInferred)
      };
    }

    // Rubric detected but not locked - still valid with effective total
    if (rubricDetected && effectiveTotalPoints) {
      let message: string;
      if (parsedRubricMeta.isWeightedRubric || parsedRubricMeta.pointScaleType === 'weighted-100') {
        message = `Weighted rubric detected — Total: ${effectiveTotalPoints} points`;
      } else if (totalPointsInferred) {
        message = `Rubric detected — total points inferred (${effectiveTotalPoints}). Lock rubric or edit below.`;
      } else if (parsedRubricMeta.hasPointValues) {
        message = `Rubric detected — scoring enabled (Total: ${effectiveTotalPoints} points)`;
      } else {
        message = `Points inferred from ${parsedRubricMeta.pointScaleType === 'per-question' ? 'answer key' : 'content'} (Total: ${effectiveTotalPoints} points)`;
      }
      
      return { 
        isValid: true, 
        totalPoints: effectiveTotalPoints,
        source: parsedRubricMeta.source,
        confidence: parsedRubricMeta.detectionConfidence,
        message
      };
    }

    // Has grading criteria (answer key) with valid total
    if (hasGradingCriteria && effectiveTotalPoints) {
      return { 
        isValid: true, 
        totalPoints: effectiveTotalPoints,
        source: parsedRubricMeta.source,
        confidence: parsedRubricMeta.detectionConfidence,
        message: `Scoring enabled (Total: ${effectiveTotalPoints} points)`
      };
    }

    // Check manual scoring settings (legacy)
    if (scoringMode === 'auto-score' && validateAutoScoreSettings(autoScoreSettings)) {
      const total = autoScoreSettings.usePointsPerQuestion 
        ? (autoScoreSettings.pointsPerQuestion || 0) * (autoScoreSettings.questionCount || 0)
        : autoScoreSettings.totalPoints || 0;
      return { 
        isValid: true, 
        totalPoints: total,
        source: 'manual' as const,
        confidence: 'high' as const,
        message: `Manual scoring configured (Total: ${total} points)`
      };
    }

    if (scoringMode === 'rubric-based') {
      const rubricMax = getMaxScoreFromQuickRubric(quickRubricSettings);
      const total = rubricMax || quickRubricSettings.totalPoints;
      if (total) {
        return { 
          isValid: true, 
          totalPoints: total,
          source: 'manual' as const,
          confidence: 'high' as const,
          message: `Quick rubric configured (Total: ${total} points)`
        };
      }
    }

    // No valid scoring configuration - but never block
    return { 
      isValid: true, // Changed from false to true - we always score
      totalPoints: 20, // Default fallback
      source: 'none' as const,
      confidence: 'none' as const,
      message: 'Using default scoring (20 points)'
    };
  }, [rubricLocked, rubricDetected, effectiveTotalPoints, totalPointsInferred, manualTotalPoints, parsedRubricMeta, hasGradingCriteria, scoringMode, autoScoreSettings, quickRubricSettings]);

  const detectRubricInText = (text: string): boolean => {
    if (!text.trim()) return false;
    const lowerText = text.toLowerCase();
    const matches = RUBRIC_KEYWORDS.filter((k) => lowerText.includes(k.toLowerCase()));
    return matches.length >= 2;
  };

  // Auto-group student files when they change
  // Also analyzes grouping confidence for multi-page safety
  useEffect(() => {
    const readyFiles = studentUpload.files.filter((f) => f.status === "ready");
    if (readyFiles.length === 0) {
      setStudentGroups([]);
      setGroupingResult(null);
      return;
    }

    // Use the new grouping analysis for confidence detection
    const analysis = analyzeAndGroupFiles(readyFiles, detectStudentNameFromText);
    setGroupingResult(analysis);
    
    // Convert StudentGroupPreview to StudentGroup format
    const groups: StudentGroup[] = analysis.groups.map(g => ({
      studentName: g.studentName,
      detectedName: g.studentName,
      nameSource: g.nameSource,
      nameConfidence: g.nameConfidence,
      nameConfirmed: g.nameConfidence === 'high' && g.nameSource === 'document',
      files: g.pages.map(p => readyFiles.find(f => f.id === p.fileId)!).filter(Boolean),
      extractedText: g.pages
        .map(p => readyFiles.find(f => f.id === p.fileId)?.extractedText || '')
        .filter(Boolean)
        .join('\n\n--- PAGE BREAK ---\n\n'),
      result: null,
      grading: false,
    }));
    
    setStudentGroups(groups);
    setSelectedGroupIndex(0);
  }, [studentUpload.files]);

  // Update student name (for teacher editing)
  const updateStudentName = (groupIndex: number, newName: string) => {
    setStudentGroups(prev => {
      const updated = [...prev];
      if (updated[groupIndex]) {
        updated[groupIndex] = {
          ...updated[groupIndex],
          studentName: newName,
          nameConfirmed: true,
          nameConfidence: 'high', // Mark as high confidence once confirmed
        };
      }
      return updated;
    });
  };

  // Inline name editing helpers
  const startNameEdit = (index: number, currentName: string) => {
    setEditingNameIndex(index);
    setEditingNameValue(currentName === 'Unknown Student' ? '' : currentName);
  };

  const confirmNameEdit = (index: number) => {
    const trimmedName = editingNameValue.trim();
    updateStudentName(index, trimmedName || 'Unknown Student');
    setEditingNameIndex(null);
    setEditingNameValue('');
  };

  const cancelNameEdit = () => {
    setEditingNameIndex(null);
    setEditingNameValue('');
  };

  // Detect rubric and control grading mode dynamically
  // When rubric is present: enable scoring mode and auto-lock
  // When no rubric: feedback-only mode (no numeric scores)
  useEffect(() => {
    const hasRubricContent = rubricFinalText.trim().length > 0;
    
    if (!hasRubricContent) {
      // NO RUBRIC: Feedback-only mode
      setGradingMode("feedback-only");
      setRubricMode("none");
      setRubricLocked(false);
      setScoringMode('feedback-only');
    } else {
      // RUBRIC DETECTED: Enable scoring mode and auto-lock
      setGradingMode("scoring");
      setRubricMode("locked");
      setRubricLocked(true);
      setScoringMode('rubric-based');
    }

    // Set rubric source description
    if (rubricFinalText.trim()) {
      if (rubricExtractedText.trim() && form.rubric.trim()) {
        setDetectedRubricSource("Uploaded files + Manual entry");
      } else if (rubricExtractedText.trim()) {
        setDetectedRubricSource("Uploaded files");
      } else {
        setDetectedRubricSource("Manual entry");
      }
    } else {
      setDetectedRubricSource("");
    }
  }, [rubricFinalText, rubricExtractedText, form.rubric]);

  // Auto-detect subject from rubric content
  useEffect(() => {
    // Combine all rubric sources for detection
    const allRubricText = [
      rubricFinalText,
      elaRubricText,
    ].filter(Boolean).join('\n');
    
    if (allRubricText.trim().length > 0) {
      const result = detectSubjectFromRubric(allRubricText);
      setDetectedSubjectResult(result);
      console.log('Detected subject:', result.subject, {
        confidence: result.confidence,
        matchCount: result.matchCount,
        matchedKeywords: result.matchedKeywords.slice(0, 5), // First 5 for brevity
        pipeline: getGradingPipeline(result.subject)
      });
    } else {
      // Reset to default when no rubric
      setDetectedSubjectResult(null);
    }
  }, [rubricFinalText, elaRubricText]);

  // Detect answer key from uploaded files or text content
  useEffect(() => {
    // Check answer key upload files
    const answerKeyFromFiles = answerKeyUpload.files.some(f => 
      f.status === 'ready' && detectAnswerKey(f.fileName, f.extractedText || '')
    );
    
    // Check rubric files (might contain answer key combined)
    const answerKeyFromRubric = rubricUpload.files.some(f => 
      f.status === 'ready' && detectAnswerKey(f.fileName, f.extractedText || '')
    );
    
    // Check pasted text for answer key keywords
    const answerKeyFromPaste = form.answer_key.trim().length > 0;
    
    // Check rubric text for answer key keywords
    const answerKeyInRubricText = form.rubric.toLowerCase().includes('answer key') || 
      form.rubric.toLowerCase().includes('answers') ||
      form.rubric.toLowerCase().includes('step-by-step') ||
      /^\s*\d+[\.\)]\s*[A-Za-z]/m.test(form.rubric); // Numbered solutions pattern
    
    setAnswerKeyDetected(answerKeyFromFiles || answerKeyFromRubric || answerKeyFromPaste || answerKeyInRubricText);
  }, [answerKeyUpload.files, rubricUpload.files, form.answer_key, form.rubric]);

  // Toggle rubric lock (for teacher control)
  const toggleRubricLock = () => {
    if (rubricLocked) {
      // Unlocking - restore manual control
      setRubricLocked(false);
      setRubricMode("draft");
    } else {
      // Locking - enforce scoring
      setRubricLocked(true);
      setRubricMode("locked");
      setScoringMode('rubric-based');
      setGradingMode('scoring');
    }
  };

  const updateForm = (field: keyof GradePapersForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleStudentFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      studentUpload.addFiles(e.target.files);
    }
    if (studentFileInputRef.current) studentFileInputRef.current.value = "";
  };

  const handleRubricFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) rubricUpload.addFiles(e.target.files);
    if (rubricFileInputRef.current) rubricFileInputRef.current.value = "";
  };

  const handleAnswerKeyFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) answerKeyUpload.addFiles(e.target.files);
    if (answerKeyFileInputRef.current) answerKeyFileInputRef.current.value = "";
  };

  // ELA Rubric file upload handler
  const handleElaRubricFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (elaRubricFileInputRef.current) elaRubricFileInputRef.current.value = "";
    
    // Validate file type
    const allowedTypes = ['.txt', '.doc', '.docx', '.pdf'];
    const fileExt = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!allowedTypes.includes(fileExt)) {
      toast({ 
        title: "Invalid file type", 
        description: "Please upload a .txt, .doc, .docx, or .pdf file",
        variant: "destructive"
      });
      return;
    }
    
    setElaRubricFileLoading(true);
    setElaRubricFileName(file.name);
    
    try {
      // Handle text files directly
      if (fileExt === '.txt') {
        const text = await file.text();
        setElaRubricText(text);
        setElaRubricSource('file');
        toast({ title: "Rubric loaded!", description: `${file.name} (${text.length} characters)` });
        setElaRubricFileLoading(false);
      } 
      // For PDF/DOC files, we need to extract text via edge function
      else if (fileExt === '.pdf' || fileExt === '.doc' || fileExt === '.docx') {
        // Convert file to base64 for processing
        const reader = new FileReader();
        reader.onload = async (event) => {
          try {
            const base64 = (event.target?.result as string)?.split(',')[1];
            if (!base64) throw new Error('Failed to read file');
            
            // Call extract-text edge function
            const { data, error } = await supabase.functions.invoke("extract-text", {
              body: {
                file_data: base64,
                file_name: file.name,
                mime_type: file.type || 'application/octet-stream',
              },
            });
            
            if (error) throw error;
            
            if (data?.text) {
              setElaRubricText(data.text);
              setElaRubricSource('file');
              toast({ title: "Rubric extracted!", description: `${file.name} (${data.text.length} characters)` });
            } else {
              throw new Error('No text extracted from file');
            }
          } catch (err) {
            console.error('ELA rubric extraction error:', err);
            toast({ 
              title: "Extraction failed", 
              description: "Could not extract text from file. Try pasting the rubric instead.",
              variant: "destructive"
            });
            setElaRubricFileName(null);
          } finally {
            setElaRubricFileLoading(false);
          }
        };
        reader.readAsDataURL(file);
      }
    } catch (err) {
      console.error('ELA rubric file error:', err);
      toast({ 
        title: "File read error", 
        description: "Could not read the file. Please try again.",
        variant: "destructive"
      });
      setElaRubricFileName(null);
      setElaRubricFileLoading(false);
    }
  };

  // Clear ELA rubric file
  const clearElaRubricFile = () => {
    setElaRubricText("");
    setElaRubricFileName(null);
    setElaRubricSource("paste");
  };


  const handleGenerateGrades = async () => {
    if (studentGroups.length === 0) {
      toast({ title: "No student work", description: "Upload files first.", variant: "destructive" });
      return;
    }

    // Check if grouping needs review (low confidence with multiple students)
    if (groupingResult && groupingResult.confidence === 'low' && studentGroups.length > 1) {
      // Show review modal instead of grading directly
      setPendingGroupsForReview(groupingResult.groups);
      setGroupingReviewOpen(true);
      return;
    }

    // Proceed with grading
    await executeGrading();
  };

  // Handle confirmed grouping from review modal
  const handleGroupingConfirmed = (confirmedGroups: StudentGroupPreview[]) => {
    const readyFiles = studentUpload.files.filter((f) => f.status === "ready");
    
    // Convert confirmed groups back to StudentGroup format
    const groups: StudentGroup[] = confirmedGroups.map(g => ({
      studentName: g.studentName,
      detectedName: g.studentName,
      nameSource: g.nameSource,
      nameConfidence: 'high' as const, // User confirmed
      nameConfirmed: true,
      files: g.pages.map(p => readyFiles.find(f => f.id === p.fileId)!).filter(Boolean),
      extractedText: g.pages
        .map(p => readyFiles.find(f => f.id === p.fileId)?.extractedText || '')
        .filter(Boolean)
        .join('\n\n--- PAGE BREAK ---\n\n'),
      result: null,
      grading: false,
    }));
    
    setStudentGroups(groups);
    setSelectedGroupIndex(0);
    
    // Now proceed with grading
    setTimeout(() => executeGrading(), 100);
  };

  const handleGroupingCancelled = () => {
    // Just close the modal, don't grade
    setPendingGroupsForReview([]);
  };

  const executeGrading = async () => {
    if (studentGroups.length === 0) {
      toast({ title: "No student work", description: "Upload files first.", variant: "destructive" });
      return;
    }

    setGrading(true);

    // Route to appropriate pipeline based on subject
    if (gradingSubject === "ela") {
      await executeELAGrading();
    } else {
      await executeMathGrading();
    }

    setGrading(false);
  };

  // ELA/Writing grading pipeline
  const executeELAGrading = async () => {
    console.log('[GradePapers] Starting ELA grading pipeline');
    
    const updatedGroups = [...studentGroups];
    const newElaResults = new Map(elaResults);

    for (let i = 0; i < updatedGroups.length; i++) {
      const group = updatedGroups[i];
      updatedGroups[i] = { ...group, grading: true };
      setStudentGroups([...updatedGroups]);

      try {
        const { data, error } = await supabase.functions.invoke("grade-ela", {
          body: {
            student_work: group.extractedText,
            student_name: group.studentName,
            rubric_text: elaRubricText.trim() || undefined,
            grade_level: form.grade_level || undefined,
            assignment_type: "Writing",
          },
        });

        if (error) throw error;

        // Store ELA result
        const elaResult: ELAGradeResponse = {
          student_name: data.student_name || group.studentName,
          score: data.score || "N/A",
          letter_grade: data.letter_grade,
          percent: data.percent,
          earned: data.earned,
          possible: data.possible,
          strengths: data.strengths || [],
          areas_for_improvement: data.areas_for_improvement || [],
          next_step: data.next_step || "Keep practicing!",
          confidence: data.confidence || 70,
          criterion_breakdown: data.criterion_breakdown,
          teacher_notes: data.teacher_notes,
          rubric_used: data.rubric_used,
        };

        newElaResults.set(group.studentName, elaResult);

        // Also update the group result for compatibility
        updatedGroups[i] = {
          ...group,
          grading: false,
          result: {
            score_suggestion: data.score || "N/A",
            score_percent: data.percent,
            letter_grade: data.letter_grade,
            confidence: data.confidence >= 80 ? 'high' : data.confidence >= 60 ? 'medium' : 'low',
            rubric_source: data.rubric_used?.source === 'teacher' ? 'teacher' : 'auto-generated',
            strengths: data.strengths?.join("; ") || "Not provided",
            areas_for_improvement: data.areas_for_improvement?.join("; ") || "Not provided",
            feedback_paragraph: data.next_step || "Not provided",
          },
        };
      } catch (error) {
        console.error(`ELA grading error for ${group.studentName}:`, error);
        updatedGroups[i] = {
          ...group,
          grading: false,
          result: {
            score_suggestion: "Error",
            strengths: "Grading failed",
            areas_for_improvement: "Please try again",
            feedback_paragraph: error instanceof Error ? error.message : "Unknown error",
          },
        };
      }

      setStudentGroups([...updatedGroups]);
    }

    setElaResults(newElaResults);
    toast({ title: `Graded ${updatedGroups.length} student(s) (ELA)!` });
  };

  // Math grading pipeline (existing logic preserved)
  const executeMathGrading = async () => {
    // Determine if we're in scoring mode (rubric present) or feedback-only mode
    const isScoring = rubricDetected && gradingMode === "scoring";
    const finalTotalPoints = isScoring ? (effectiveTotalPoints || 20) : null;
    
    // Show non-blocking warning if total was inferred (only in scoring mode)
    if (isScoring && totalPointsInferred && !manualTotalPoints) {
      toast({ 
        title: "Total points inferred", 
        description: `Using ${finalTotalPoints} points. You can edit the score after grading.`,
      });
    }

    // Build effective rubric: only use if we're in scoring mode
    const effectiveRubric = isScoring
      ? (rubricFinalText || (detectRubricInText(studentUpload.combinedText) ? studentUpload.combinedText : ""))
      : "";
    
    console.log('[GradePapers] Grading with mode:', gradingMode, 'isScoring:', isScoring, {
      rubricFinalTextLength: rubricFinalText.length,
      effectiveRubricLength: effectiveRubric.length,
      hasRubricFromFiles: rubricExtractedText.length > 0,
      hasRubricFromPaste: form.rubric.trim().length > 0,
      parsedRubricMeta,
      effectiveTotalPoints,
      scoringValidation,
    });

    // Build auto-score settings based on scoring mode OR parsed rubric
    // PRIORITY: manualTotalPoints > parsedRubricMeta.totalPoints > default
    let effectiveAutoScoreSettings = undefined;
    
    // If rubric is locked or has effective total points, use those
    if (rubricLocked || effectiveTotalPoints) {
      effectiveAutoScoreSettings = {
        ...autoScoreSettings,
        totalPoints: effectiveTotalPoints || 20,
        usePointsPerQuestion: false,
      };
    } else if (scoringMode === 'auto-score') {
      effectiveAutoScoreSettings = autoScoreSettings;
    } else if (scoringMode === 'rubric-based') {
      // Rubric-based: convert to total points mode
      const rubricMax = getMaxScoreFromQuickRubric(quickRubricSettings);
      effectiveAutoScoreSettings = {
        ...autoScoreSettings,
        totalPoints: rubricMax || quickRubricSettings.totalPoints,
        usePointsPerQuestion: false,
      };
    }

    // Build quick rubric categories for AI prompt
    const quickRubricCategories = quickRubricSettings.enabled 
      ? quickRubricSettings.categories.map(c => `${c.name}: ${c.points} pts`).join(', ')
      : '';

    // Grade each student group independently
    const updatedGroups = [...studentGroups];

    for (let i = 0; i < updatedGroups.length; i++) {
      const group = updatedGroups[i];
      updatedGroups[i] = { ...group, grading: true };
      setStudentGroups([...updatedGroups]);

      try {
        const { data, error } = await supabase.functions.invoke("grade-paper", {
          body: {
            student_work: group.extractedText,
            grade_level: form.grade_level,
            subject: form.subject,
            rubric: effectiveRubric,
            answer_key: isScoring ? (answerKeyTextCombined || null) : null,
            grading_mode: gradingMode,
            scoring_mode: isScoring ? scoringMode : 'feedback-only',
            auto_score_settings: isScoring ? effectiveAutoScoreSettings : undefined,
            quick_rubric_categories: isScoring ? quickRubricCategories : '',
          },
        });

        if (error) throw error;

        // Build result based on mode - feedback-only mode gets no scores
        updatedGroups[i] = {
          ...group,
          grading: false,
          result: {
            score_suggestion: isScoring ? (data.score_suggestion || "0/20") : "N/A",
            score_derivation: isScoring ? data.score_derivation : undefined,
            score_percent: isScoring ? (data.score_percent || 0) : undefined,
            letter_grade: isScoring ? data.letter_grade : undefined,
            confidence: data.confidence || 'medium',
            rubric_source: isScoring ? (data.rubric_source || 'auto-generated') : undefined,
            strengths: data.strengths || "Not provided",
            areas_for_improvement: data.areas_for_improvement || "Not provided",
            feedback_paragraph: data.feedback_paragraph || "Not provided",
          },
        };
      } catch (error) {
        console.error(`Grading error for ${group.studentName}:`, error);
        updatedGroups[i] = {
          ...group,
          grading: false,
          result: {
            score_suggestion: "Error",
            strengths: "Grading failed",
            areas_for_improvement: "Please try again",
            feedback_paragraph: error instanceof Error ? error.message : "Unknown error",
          },
        };
      }

      setStudentGroups([...updatedGroups]);
    }

    toast({ title: `Graded ${updatedGroups.length} student(s)!` });

    // Feedback is now handled by usePilotFeedback hook with smart timing
  };

  const updateGroupResult = (groupIndex: number, field: keyof GradingResult, value: string) => {
    setStudentGroups((prev) => {
      const updated = [...prev];
      if (updated[groupIndex]?.result) {
        updated[groupIndex] = {
          ...updated[groupIndex],
          result: { ...updated[groupIndex].result!, [field]: value },
        };
      }
      return updated;
    });
  };

  const handleCopy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    toast({ title: `${label} copied!` });
    setTimeout(() => setCopied(null), 2000);
  };

  const handleDownloadPdf = async () => {
    const currentGroup = studentGroups[selectedGroupIndex];
    if (!currentGroup?.result) return;

    setDownloadingPdf(true);

    try {
      const { data, error } = await supabase.functions.invoke("generate-pdf-report", {
        body: {
          studentName: currentGroup.studentName,
          assignmentName: form.subject || "Assignment",
          score: currentGroup.result.score_suggestion,
          strengths: currentGroup.result.strengths,
          areasForImprovement: currentGroup.result.areas_for_improvement,
          feedback: currentGroup.result.feedback_paragraph,
          gradingMode: gradingMode,
          subject: form.subject,
          gradeLevel: form.grade_level,
          generatedAt: new Date().toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          }),
        },
      });

      if (error) throw error;

      if (data?.fallback) {
        const printWindow = window.open("", "_blank");
        if (printWindow) {
          printWindow.document.write(data.html);
          printWindow.document.close();
          printWindow.focus();
          setTimeout(() => {
            printWindow.print();
            printWindow.close();
          }, 500);
        }
        toast({ title: "PDF generated using print dialog" });
        return;
      }

      const blob = new Blob([data], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const dateStr = new Date().toISOString().split("T")[0];
      const sanitizedStudent = currentGroup.studentName.replace(/[^a-zA-Z0-9]/g, "_");
      const sanitizedAssignment = (form.subject || "Assignment").replace(/[^a-zA-Z0-9]/g, "_");
      const filename = `GradeReport_${sanitizedStudent}_${sanitizedAssignment}_${dateStr}.pdf`;

      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast({ title: "PDF downloaded!" });
    } catch (error) {
      console.error("PDF download error:", error);
      toast({ title: "PDF download failed", variant: "destructive" });
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handlePrintReport = () => {
    const currentGroup = studentGroups[selectedGroupIndex];
    if (!currentGroup?.result) return;

    const printContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Grade Report - ${currentGroup.studentName}</title>
        <style>
          @page { size: letter portrait; margin: 0.75in; }
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: 'Segoe UI', Tahoma, sans-serif; font-size: 11pt; line-height: 1.5; color: #1a1a1a; padding: 20px; }
          .header { text-align: center; border-bottom: 2px solid #2563eb; padding-bottom: 16px; margin-bottom: 24px; }
          .header h1 { font-size: 20pt; font-weight: 700; color: #1e40af; margin-bottom: 4px; }
          .header .subtitle { font-size: 10pt; color: #6b7280; }
          .meta-info { display: flex; flex-wrap: wrap; gap: 16px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; margin-bottom: 24px; }
          .meta-item { flex: 1; min-width: 120px; }
          .meta-label { font-size: 9pt; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px; }
          .meta-value { font-size: 11pt; font-weight: 600; color: #1a1a1a; }
          .section { margin-bottom: 20px; page-break-inside: avoid; }
          .section-title { font-size: 12pt; font-weight: 600; color: #1e40af; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-bottom: 10px; }
          .section-content { font-size: 11pt; line-height: 1.6; color: #374151; white-space: pre-wrap; }
          .score-box { background: linear-gradient(135deg, #dbeafe 0%, #eff6ff 100%); border: 2px solid #3b82f6; border-radius: 12px; padding: 16px 24px; text-align: center; margin-bottom: 24px; }
          .score-label { font-size: 10pt; color: #1e40af; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
          .score-value { font-size: 28pt; font-weight: 700; color: #1e40af; }
          .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 9pt; color: #9ca3af; }
          @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Grade Report</h1>
          <div class="subtitle">Generated on ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</div>
        </div>
        <div class="meta-info">
          <div class="meta-item"><div class="meta-label">Student</div><div class="meta-value">${currentGroup.studentName}</div></div>
          ${form.subject ? `<div class="meta-item"><div class="meta-label">Subject</div><div class="meta-value">${form.subject}</div></div>` : ""}
          ${form.grade_level ? `<div class="meta-item"><div class="meta-label">Grade Level</div><div class="meta-value">${form.grade_level}</div></div>` : ""}
        </div>
        ${
          hasScoringEnabled && currentGroup.result.score_suggestion !== "N/A"
            ? `
          <div class="score-box">
            <div class="score-label">Suggested Score</div>
            <div class="score-value">${currentGroup.result.score_suggestion}</div>
          </div>
        `
            : ""
        }
        <div class="section"><div class="section-title">Strengths</div><div class="section-content">${currentGroup.result.strengths}</div></div>
        <div class="section"><div class="section-title">Areas for Improvement</div><div class="section-content">${currentGroup.result.areas_for_improvement}</div></div>
        <div class="section"><div class="section-title">Draft Feedback</div><div class="section-content">${currentGroup.result.feedback_paragraph}</div></div>
        <div class="footer">This report was generated using AI assistance. Please review before sharing.</div>
      </body>
      </html>
    `;

    const printWindow = window.open("", "_blank");
    if (printWindow) {
      printWindow.document.write(printContent);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => printWindow.print(), 300);
    }
  };

  const handleSave = async () => {
    const currentGroup = studentGroups[selectedGroupIndex];
    if (!currentGroup?.result) return;

    // Prompt guests to sign up
    if (isGuest || !user) {
      toast({ 
        title: "Account Required", 
        description: "Create a free account to save and revisit your grading sessions.",
      });
      return;
    }

    setSaving(true);
    try {
      const sessionData = {
        user_id: user.id,
        status: "completed",
        title: `${currentGroup.studentName} - ${form.subject || "Grading"}`,
        snippet: `Score: ${currentGroup.result.score_suggestion}`,
        summary_json: {
          ...currentGroup.result,
          input_type: "grading",
          grading_mode: gradingMode,
          studentName: currentGroup.studentName,
        },
        teacher_notes: JSON.stringify(form),
        transcript: currentGroup.extractedText,
      };

      if (sessionId) {
        await supabase.from("sessions").update(sessionData).eq("id", sessionId);
      } else {
        const { data } = await supabase.from("sessions").insert(sessionData).select().single();
        if (data) setSessionId(data.id);
      }
      toast({ title: "Saved successfully!" });
    } catch (error) {
      toast({ title: "Save failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-bottor-gradient flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const isExtracting = studentUpload.isExtracting || rubricUpload.isExtracting || answerKeyUpload.isExtracting;
  const hasFailedFiles = studentUpload.failedFiles > 0;
  const allFilesReady = studentUpload.totalFiles > 0 && studentUpload.completedFiles === studentUpload.totalFiles;
  
  // Can generate if: has ready files AND (all files ready OR user can proceed with ready only) AND not currently grading
  const canGenerate = studentUpload.hasReadyFiles && !grading;
  const shouldWaitForProcessing = isExtracting && !hasFailedFiles;
  const currentGroup = studentGroups[selectedGroupIndex];

  return (
    <div className="min-h-screen bg-bottor-gradient">
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-sm border-b border-border p-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="text-muted-foreground">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Home
            </Button>
            <h1 className="text-xl font-bold text-foreground">Grade Papers</h1>
          </div>
          {isGuest && (
            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
              Pilot Mode
            </span>
          )}
        </div>
      </header>

      {/* Guest Pilot Notice */}
      {isGuest && (
        <div className="max-w-2xl mx-auto px-4 pt-4">
          <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20 text-sm text-muted-foreground">
            <Info className="w-4 h-4 text-primary flex-shrink-0" />
            <span>Pilot Mode — sample documents only. Feedback welcome.</span>
          </div>
        </div>
      )}

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Detected Subject Badge (shown when subject auto-detected) */}
        {detectedSubjectResult && detectedSubjectResult.subject !== 'General' && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Detected subject:</span>
            <Badge variant="outline" className="font-medium">
              {detectedSubjectResult.subject}
            </Badge>
            {detectedSubjectResult.confidence.level === 'high' && (
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            )}
          </div>
        )}

        {/* ===== STUDENT WORK (REQUIRED) ===== */}
        <Card className="border-2 border-primary/30 shadow-lg bg-primary/5">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg">Student Work (Required)</CardTitle>
              <CardDescription className="text-xs">
                Bottor automatically detects student names inside each document. No special file naming required.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {studentUpload.files.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={studentUpload.clearAllFiles}
                  className="text-muted-foreground hover:text-destructive"
                >
                  Clear all
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <input
                ref={studentFileInputRef}
                type="file"
                multiple
                accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif"
                onChange={handleStudentFileSelect}
                className="hidden"
                id="student-file-upload"
              />
              <label
                htmlFor="student-file-upload"
                className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-muted-foreground/25 rounded-lg cursor-pointer hover:border-primary/50 transition-colors bg-muted/20"
              >
                {/* Stacked document icons to indicate multiple files */}
                <div className="relative mb-2">
                  <FileText className="w-5 h-5 text-muted-foreground/40 absolute -left-1 -top-1" />
                  <FileText className="w-6 h-6 text-muted-foreground relative z-10" />
                </div>
                <span className="text-sm font-medium text-foreground">Upload Student Work</span>
                <span className="text-sm text-muted-foreground mt-1">
                  📄 Upload single or multiple student submissions at once
                </span>
                <span className="text-xs text-muted-foreground/70 mt-1">
                  Any filename works — student names detected from document content
                </span>
              </label>
            </div>

            {studentUpload.files.length > 0 && (
              <FileUploadList
                files={studentUpload.files}
                onRemove={studentUpload.removeFile}
                onRetry={studentUpload.retryExtraction}
                label="Uploaded Files"
                totalFiles={studentUpload.totalFiles}
                completedFiles={studentUpload.completedFiles}
                failedFiles={studentUpload.failedFiles}
                progress={studentUpload.progress}
                isExtracting={studentUpload.isExtracting}
              />
            )}

            {/* Student Groups Preview */}
            {studentGroups.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-primary" />
                  <Label className="text-sm font-medium">Detected Students ({studentGroups.length})</Label>
                </div>
                
                {/* Multi-page grouping confidence warning */}
                {groupingResult && groupingResult.confidence === 'low' && studentGroups.length > 1 && (
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                    <Info className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                        Page grouping needs confirmation
                      </p>
                      <p className="text-xs text-amber-700 dark:text-amber-300">
                        Multiple students detected with some unnamed pages. When you click Grade, you'll be asked to confirm pages are grouped correctly.
                      </p>
                    </div>
                  </div>
                )}
                
                {/* Non-blocking name verification banner */}
                {!(groupingResult && groupingResult.confidence === 'low' && studentGroups.length > 1) && 
                 studentGroups.some(g => !g.nameConfirmed && (g.nameSource === 'unknown' || g.nameConfidence === 'low')) && (
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                    <Info className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                        Names detected automatically
                      </p>
                      <p className="text-xs text-amber-700 dark:text-amber-300">
                        Please confirm or edit any names marked for verification to ensure accurate grading. You can proceed without confirming — we'll use the detected names.
                      </p>
                    </div>
                  </div>
                )}
                
                <div className="space-y-2">
                  {studentGroups.map((group, idx) => {
                    // Determine confidence state
                    const isHighConfidence = group.nameConfirmed || 
                      (group.nameSource === 'document' && group.nameConfidence === 'high');
                    const needsVerification = !group.nameConfirmed && 
                      (group.nameSource === 'unknown' || group.nameConfidence === 'low');
                    const isEditing = editingNameIndex === idx;
                    
                    return (
                      <div
                        key={`${group.detectedName}-${idx}`}
                        className={`flex items-center gap-2 p-3 rounded-lg border transition-colors ${
                          idx === selectedGroupIndex 
                            ? 'border-primary bg-primary/5' 
                            : 'border-muted bg-background hover:border-primary/30'
                        }`}
                        onClick={() => setSelectedGroupIndex(idx)}
                      >
                        {/* Confidence indicator */}
                        <div className="flex-shrink-0">
                          {isHighConfidence ? (
                            <div className="w-6 h-6 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                            </div>
                          ) : (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="w-6 h-6 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center cursor-help">
                                    <Info className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent side="left">
                                  <p className="text-xs max-w-[200px]">
                                    {group.nameSource === 'unknown' 
                                      ? 'Name could not be detected. Please enter manually.'
                                      : 'Name detected but may need verification. Click to edit.'}
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </div>
                        
                        {/* Name field */}
                        <div className="flex-1 min-w-0">
                          {isEditing ? (
                            <div className="flex items-center gap-2">
                              <Input
                                autoFocus
                                value={editingNameValue}
                                onChange={(e) => setEditingNameValue(e.target.value)}
                                placeholder="Enter student name..."
                                className="h-8 text-sm flex-1"
                                onClick={(e) => e.stopPropagation()}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    confirmNameEdit(idx);
                                  } else if (e.key === 'Escape') {
                                    cancelNameEdit();
                                  }
                                }}
                              />
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 w-8 p-0 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  confirmNameEdit(idx);
                                }}
                                title="Confirm"
                              >
                                <Check className="w-4 h-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  cancelNameEdit();
                                }}
                                title="Cancel"
                              >
                                <X className="w-4 h-4" />
                              </Button>
                            </div>
                          ) : (
                            <div 
                              className="flex flex-col gap-0.5 cursor-text"
                              onClick={(e) => {
                                e.stopPropagation();
                                startNameEdit(idx, group.studentName);
                              }}
                            >
                              <div className="flex items-center gap-2">
                                <span className={`text-sm font-medium truncate ${
                                  group.studentName === 'Unknown Student' ? 'text-muted-foreground italic' : ''
                                }`}>
                                  {group.studentName === 'Unknown Student' ? 'Click to enter name' : group.studentName}
                                </span>
                                <Badge variant="outline" className="text-xs flex-shrink-0 font-normal">
                                  {group.files.length} file{group.files.length !== 1 ? 's' : ''}
                                </Badge>
                                {group.result && (
                                  <Badge variant="secondary" className="text-xs flex-shrink-0 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                                    Graded
                                  </Badge>
                                )}
                              </div>
                              <span className="text-xs text-muted-foreground">
                                {isHighConfidence 
                                  ? 'Detected from document' 
                                  : needsVerification 
                                    ? 'Needs verification — click to edit'
                                    : 'Detected from filename'}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ===== ELA RUBRIC INPUT (Conditional) - BELOW Student Work ===== */}
        {gradingSubject === "ela" && (
          <Card className="border border-purple-200 dark:border-purple-800 bg-purple-50/30 dark:bg-purple-900/10 transition-all duration-300">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <PenLine className="w-4 h-4 text-purple-500" />
                ELA Rubric
                <span className="text-xs font-normal text-muted-foreground ml-1">(Optional)</span>
                {elaRubricText.length > 0 && (
                  <Badge variant="secondary" className="ml-auto text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border-purple-300">
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    Ready
                  </Badge>
                )}
              </CardTitle>
              <CardDescription className="text-xs">
                Leave blank for feedback-only mode. Add a rubric for scored grading.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-0">
              {/* Tabs for Paste Text vs Upload File */}
              <Tabs defaultValue="paste" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="paste" className="text-sm">
                    <FileText className="w-4 h-4 mr-2" />
                    Paste Text
                  </TabsTrigger>
                  <TabsTrigger value="upload" className="text-sm">
                    <Upload className="w-4 h-4 mr-2" />
                    Upload File
                  </TabsTrigger>
                </TabsList>
                
                {/* Tab 1: Paste Text */}
                <TabsContent value="paste" className="space-y-3 mt-4">
                  <div className="relative">
                    <Textarea
                      placeholder="Paste your ELA/Writing rubric here...&#10;&#10;Example:&#10;Ideas & Content (25 pts): Development of ideas with supporting details&#10;Organization (20 pts): Structure, transitions, logical flow&#10;Voice (15 pts): Engagement, appropriate tone&#10;..."
                      value={elaRubricSource === 'paste' ? elaRubricText : ''}
                      onChange={(e) => {
                        setElaRubricText(e.target.value);
                        setElaRubricSource('paste');
                        setElaRubricFileName(null);
                      }}
                      className="min-h-[200px] text-sm resize-y"
                      disabled={elaRubricSource === 'file' && elaRubricFileName !== null}
                    />
                    {elaRubricSource === 'paste' && elaRubricText.length > 0 && (
                      <div className="absolute bottom-2 right-2 text-xs text-muted-foreground bg-background/90 px-2 py-0.5 rounded border">
                        {elaRubricText.length} characters
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Lightbulb className="w-3 h-3" />
                    For best results, include point values for each criterion (e.g., "Ideas: 25 pts")
                  </p>
                </TabsContent>
                
                {/* Tab 2: Upload File */}
                <TabsContent value="upload" className="space-y-3 mt-4">
                  <input
                    ref={elaRubricFileInputRef}
                    type="file"
                    accept=".txt,.doc,.docx,.pdf"
                    onChange={handleElaRubricFileSelect}
                    className="hidden"
                    id="ela-rubric-file-upload"
                  />
                  
                  {/* Show upload button or file info */}
                  {!elaRubricFileName ? (
                    <label
                      htmlFor="ela-rubric-file-upload"
                      className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-purple-300 dark:border-purple-700 rounded-lg cursor-pointer hover:border-purple-400 dark:hover:border-purple-600 transition-colors bg-purple-50/50 dark:bg-purple-900/20"
                    >
                      <Upload className="w-8 h-8 text-purple-400 mb-2" />
                      <span className="text-sm font-medium text-foreground">Upload Rubric File</span>
                      <span className="text-xs text-muted-foreground mt-1">
                        Accepts .txt, .doc, .docx, .pdf
                      </span>
                    </label>
                  ) : (
                    <div className="p-4 border border-purple-200 dark:border-purple-800 rounded-lg bg-purple-50/50 dark:bg-purple-900/20">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {elaRubricFileLoading ? (
                            <Loader2 className="w-5 h-5 text-purple-500 animate-spin" />
                          ) : (
                            <CheckCircle2 className="w-5 h-5 text-purple-500" />
                          )}
                          <div>
                            <p className="text-sm font-medium">{elaRubricFileName}</p>
                            <p className="text-xs text-muted-foreground">
                              {elaRubricFileLoading 
                                ? 'Extracting text...' 
                                : `${elaRubricText.length} characters extracted`
                              }
                            </p>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={clearElaRubricFile}
                          className="text-muted-foreground hover:text-destructive"
                          disabled={elaRubricFileLoading}
                        >
                          <X className="w-4 h-4" />
                          Clear
                        </Button>
                      </div>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Upload your rubric as a text or document file
                  </p>
                </TabsContent>
              </Tabs>
              
              {/* Rubric Tips - Collapsible */}
              <Collapsible open={elaRubricTipsOpen} onOpenChange={setElaRubricTipsOpen}>
                <CollapsibleTrigger asChild>
                  <button className="flex items-center gap-2 text-xs text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 transition-colors w-full justify-start py-2">
                    <BookOpen className="w-3.5 h-3.5" />
                    <span className="font-medium">📋 Rubric Tips</span>
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${elaRubricTipsOpen ? 'rotate-180' : ''}`} />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2">
                  <div className="p-3 rounded-lg bg-purple-100/50 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-800 text-xs text-purple-800 dark:text-purple-200 space-y-2">
                    <ul className="list-disc list-inside space-y-1">
                      <li>Include specific criteria like <strong>Ideas & Content</strong>, <strong>Organization</strong>, <strong>Language & Style</strong>, <strong>Conventions</strong>.</li>
                      <li>For scored grading, include point values (e.g., "Ideas: 25 pts").</li>
                      <li>Leave blank for <strong>feedback-only mode</strong> — qualitative feedback without numeric scores.</li>
                    </ul>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </CardContent>
          </Card>
        )}

        {/* ===== GRADING CRITERIA (OPTIONAL - MATH ONLY) - COLLAPSED ACCORDION ===== */}
        {gradingSubject === "math" && (
        <Collapsible open={gradingCriteriaOpen} onOpenChange={setGradingCriteriaOpen}>
          <Card className={`border shadow-sm transition-colors ${
            hasGradingCriteria 
              ? "border-primary/30 bg-primary/5" 
              : "border-muted bg-muted/5"
          }`}>
            <CollapsibleTrigger asChild>
              <CardHeader className="cursor-pointer hover:bg-muted/20 transition-colors rounded-t-lg pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <BookOpen className="w-5 h-5 text-muted-foreground" />
                    <div>
                      <CardTitle className="text-base font-medium flex items-center gap-2">
                        Grading Criteria
                        <span className="text-xs font-normal text-muted-foreground">Optional</span>
                        {rubricDetected && (
                          <Badge variant="secondary" className="text-xs bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-300">
                            <Lock className="w-3 h-3 mr-1" />
                            Locked for Scoring
                          </Badge>
                        )}
                      </CardTitle>
                      <CardDescription className="text-xs mt-0.5">
                        {rubricDetected 
                          ? "Rubric detected and locked. Numeric score will be calculated from your criteria."
                          : "Feedback only mode is on, upload a rubric to unlock scoring."}
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {hasGradingCriteria && (
                      <Badge variant="secondary" className="text-xs bg-primary/10 text-primary border-primary/20">
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                        Ready
                      </Badge>
                    )}
                    <ChevronDown className={`w-5 h-5 text-muted-foreground transition-transform duration-200 ${
                      gradingCriteriaOpen ? "rotate-180" : ""
                    }`} />
                  </div>
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            
            <CollapsibleContent>
              <CardContent className="space-y-6 pt-0">
                {/* ===== ANSWER KEY SECTION ===== */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <FileSearch className="w-4 h-4 text-muted-foreground" />
                    <Label className="text-sm font-medium">Answer Key</Label>
                    <span className="text-xs text-muted-foreground">(Optional)</span>
                  </div>
                  <p className="text-xs text-muted-foreground -mt-1">
                    Used to improve accuracy and enable scoring. Not required for feedback.
                  </p>
                  
                  {/* Answer Key File Upload */}
                  <div className="space-y-2">
                    <input
                      ref={answerKeyFileInputRef}
                      type="file"
                      multiple
                      accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif"
                      onChange={handleAnswerKeyFileSelect}
                      className="hidden"
                      id="answerkey-file-upload"
                    />
                    <label
                      htmlFor="answerkey-file-upload"
                      className="flex items-center justify-center w-full h-12 border-2 border-dashed border-muted-foreground/25 rounded-lg cursor-pointer hover:border-primary/50 transition-colors bg-muted/20"
                    >
                      <Upload className="w-4 h-4 text-muted-foreground mr-2" />
                      <span className="text-sm text-muted-foreground">Upload answer key files</span>
                    </label>

                    {/* Uploaded Answer Key Files List */}
                    {answerKeyUpload.files.length > 0 && (
                      <div className="space-y-1">
                        {answerKeyUpload.files.map((file) => (
                          <div key={file.id} className="flex items-center justify-between p-2 bg-muted/30 rounded-md">
                            <div className="flex items-center gap-2 min-w-0">
                              <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                              <span className="text-sm truncate">{file.fileName}</span>
                              <Badge variant="outline" className="text-xs flex-shrink-0">
                                {file.status === "ready" ? "Ready" : file.status}
                              </Badge>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => answerKeyUpload.removeFile(file.id)}
                              className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                            >
                              <X className="w-3 h-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Answer Key Textarea */}
                  <Textarea
                    placeholder="Or paste answer key text here..."
                    value={form.answer_key}
                    onChange={(e) => updateForm("answer_key", e.target.value)}
                    rows={3}
                    className="text-sm"
                  />
                </div>

                {/* Divider */}
                <div className="border-t border-muted" />

                {/* ===== RUBRIC SECTION ===== */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-muted-foreground" />
                    <Label className="text-sm font-medium">Rubric</Label>
                    <span className="text-xs text-muted-foreground">(Optional)</span>
                  </div>
                  <p className="text-xs text-muted-foreground -mt-1">
                    Used for category-based or standards-based grading.
                  </p>
                  
                  {/* Rubric File Upload */}
                  <div className="space-y-2">
                    <input
                      ref={rubricFileInputRef}
                      type="file"
                      multiple
                      accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif"
                      onChange={handleRubricFileSelect}
                      className="hidden"
                      id="rubric-file-upload"
                      disabled={rubricMode === "locked"}
                    />
                    <label
                      htmlFor="rubric-file-upload"
                      className={`flex items-center justify-center w-full h-12 border-2 border-dashed rounded-lg transition-colors ${
                        rubricMode === "locked"
                          ? "border-muted/50 bg-muted/10 cursor-not-allowed opacity-50"
                          : "border-muted-foreground/25 cursor-pointer hover:border-primary/50 bg-muted/20"
                      }`}
                    >
                      <Upload className="w-4 h-4 text-muted-foreground mr-2" />
                      <span className="text-sm text-muted-foreground">Upload rubric files</span>
                    </label>

                    {/* Uploaded Rubric Files List */}
                    {rubricUpload.files.length > 0 && (
                      <div className="space-y-1">
                        {rubricUpload.files.map((file) => (
                          <div key={file.id} className="flex items-center justify-between p-2 bg-muted/30 rounded-md">
                            <div className="flex items-center gap-2 min-w-0">
                              <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                              <span className="text-sm truncate">{file.fileName}</span>
                              <Badge variant="outline" className="text-xs flex-shrink-0">
                                {file.status === "ready" ? "Ready" : file.status}
                              </Badge>
                            </div>
                            {rubricMode !== "locked" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => rubricUpload.removeFile(file.id)}
                                className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                              >
                                <X className="w-3 h-3" />
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Rubric Textarea */}
                  <Textarea
                    placeholder="Or paste rubric / grading criteria here..."
                    value={form.rubric}
                    onChange={(e) => updateForm("rubric", e.target.value)}
                    rows={4}
                    disabled={rubricMode === "locked"}
                    className={rubricMode === "locked" ? "opacity-75 bg-muted/20" : ""}
                  />

                  {/* Warning: Rubric file uploaded but could not be read */}
                  {rubricExtractionWarning && (
                    <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-700 dark:text-amber-400">
                      <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <p className="text-xs">
                        Rubric uploaded but could not be read. Paste rubric text or upload a clearer rubric.
                      </p>
                    </div>
                  )}

                  {/* DEV DEBUG: Rubric Detection Panel */}
                  {process.env.NODE_ENV === 'development' && (rubricUpload.files.length > 0 || rubricFinalText.length > 0) && (
                    <Collapsible>
                      <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors py-1">
                        <ChevronDown className="w-3 h-3" />
                        <span>🔍 Debug: Rubric Detected</span>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-2 p-3 bg-muted/30 rounded-md border border-muted text-xs font-mono space-y-2">
                        <div>
                          <strong>Files:</strong> {rubricUpload.files.length} ({rubricUpload.files.filter(f => f.status === 'ready').length} ready)
                        </div>
                        <div>
                          <strong>Extracted Text Length:</strong> {rubricExtractedText.length} chars
                        </div>
                        <div>
                          <strong>Final Text Length:</strong> {rubricFinalText.length} chars
                        </div>
                        {rubricFinalText && (
                          <div className="border-t border-muted pt-2 mt-2">
                            <strong>Preview (first 300 chars):</strong>
                            <pre className="whitespace-pre-wrap text-muted-foreground mt-1 max-h-32 overflow-auto">
                              {rubricFinalText.slice(0, 300)}{rubricFinalText.length > 300 ? '...' : ''}
                            </pre>
                          </div>
                        )}
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
        )}

        {/* ===== GRADING STATUS BANNERS (MATH ONLY) ===== */}
        {/* Answer Key Detected Banner */}
        {gradingSubject === "math" && answerKeyDetected && !rubricLocked && (
          <Card className="border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center">
                  <FileSearch className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
                    Answer key detected — accuracy boosted.
                  </p>
                  <p className="text-xs text-blue-700 dark:text-blue-300">
                    Bottor will use the answer key to validate correctness and provide more accurate scoring.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Rubric + Answer Key: Enhanced Scoring */}
        {gradingSubject === "math" && rubricLocked && answerKeyDetected && (
          <Card className="border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
                      Rubric + Answer Key detected — enhanced scoring enabled.
                    </p>
                    <p className="text-xs text-emerald-700 dark:text-emerald-300">
                      {effectiveTotalPoints 
                        ? `Total: ${effectiveTotalPoints} points. Using rubric for scoring structure and answer key for correctness validation.`
                        : `Points need to be specified. Using rubric criteria and answer key for validation.`
                      }
                    </p>
                  </div>
                </div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={toggleRubricLock}
                        className="flex-shrink-0"
                      >
                        {rubricLocked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {rubricLocked ? "Unlock rubric to show scoring options" : "Lock rubric for auto-grading"}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Rubric Only: Locked for Scoring - GREEN status card with parsed points info */}
        {gradingSubject === "math" && rubricLocked && !answerKeyDetected && (
          <Card className="border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center">
                    <Lock className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
                      Rubric locked — scoring rules enforced (Total: {effectiveTotalPoints || 20} points)
                    </p>
                    <p className="text-xs text-emerald-700 dark:text-emerald-300">
                      {parsedRubricMeta.rubricItems.length > 0 
                        ? `${parsedRubricMeta.rubricItems.length} criteria detected. ` 
                        : ''
                      }
                      {totalPointsInferred ? 'Points inferred — editable below. ' : ''}
                      Add an answer key to improve accuracy.
                    </p>
                  </div>
                </div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={toggleRubricLock}
                        className="flex-shrink-0"
                      >
                        <Lock className="w-4 h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      Unlock rubric to show scoring options
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Total Points Editor - NON-BLOCKING warning when points are inferred (defaulted to 20) */}
        {gradingSubject === "math" && rubricLocked && totalPointsInferred && (
          <Card className="border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center flex-shrink-0">
                  <Info className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                    Total points inferred — you can edit if needed
                  </p>
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    We detected a rubric but couldn't parse the point total. Using {effectiveTotalPoints || 20} points by default.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 pl-11">
                <Label htmlFor="manual-total-points" className="text-sm whitespace-nowrap">
                  Total points for this assignment:
                </Label>
                <Input
                  id="manual-total-points"
                  type="number"
                  min="1"
                  max="1000"
                  placeholder="20"
                  value={manualTotalPoints || effectiveTotalPoints || 20}
                  onChange={(e) => setManualTotalPoints(e.target.value ? parseInt(e.target.value, 10) : null)}
                  className="w-24 h-9"
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Scoring validation message when not locked but has criteria */}
        {gradingSubject === "math" && !rubricLocked && hasGradingCriteria && scoringValidation.message && (
          <Card className={`border ${scoringValidation.isValid ? 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20' : 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20'}`}>
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <Info className={`w-4 h-4 ${scoringValidation.isValid ? 'text-blue-600 dark:text-blue-400' : 'text-amber-600 dark:text-amber-400'}`} />
                <p className={`text-sm ${scoringValidation.isValid ? 'text-blue-700 dark:text-blue-300' : 'text-amber-700 dark:text-amber-300'}`}>
                  {scoringValidation.message}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ===== SCORING OPTIONS (HIDDEN when rubric is locked) ===== */}
        {/* Only show when grading criteria exists BUT rubric is NOT locked */}
        {gradingSubject === "math" && hasGradingCriteria && !rubricLocked && (
          <ScoringOptionsSection
            scoringMode={scoringMode}
            onScoringModeChange={setScoringMode}
            autoScoreSettings={autoScoreSettings}
            onAutoScoreSettingsChange={setAutoScoreSettings}
            quickRubricSettings={quickRubricSettings}
            onQuickRubricSettingsChange={setQuickRubricSettings}
            hasRubric={rubricMode !== "none"}
            disabled={rubricMode === "locked"}
          />
        )}

        {/* ===== MODE INDICATOR ===== */}
        {gradingSubject === "math" && !rubricDetected && studentUpload.files.length > 0 && (
          <Card className="border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <p className="text-sm text-blue-700 dark:text-blue-300">
                  <span className="font-medium">Feedback only mode is on</span>, upload a rubric to unlock scoring.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ELA: Feedback-only mode indicator */}
        {gradingSubject === "ela" && studentUpload.files.length > 0 && elaRubricText.trim().length === 0 && (
          <Card className="border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                <p className="text-sm text-purple-700 dark:text-purple-300">
                  <span className="font-medium">Feedback only mode</span> — add an ELA rubric above to unlock scored grading.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ELA: Rubric provided indicator */}
        {gradingSubject === "ela" && studentUpload.files.length > 0 && elaRubricText.trim().length > 0 && (
          <Card className="border border-purple-300 dark:border-purple-700 bg-purple-50 dark:bg-purple-900/20">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                <p className="text-sm text-purple-700 dark:text-purple-300">
                  <span className="font-medium">ELA rubric provided</span> — scored grading enabled ({elaRubricText.length} characters).
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="sticky bottom-4 z-10 bg-background/95 backdrop-blur-sm p-4 -mx-4 rounded-lg shadow-lg border space-y-2">
          {/* Show info about processing state */}
          {shouldWaitForProcessing && (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Processing {studentUpload.completedFiles}/{studentUpload.totalFiles} files...
            </div>
          )}
          
          {/* Show warning if some files failed but can still proceed */}
          {hasFailedFiles && studentUpload.hasReadyFiles && !isExtracting && (
            <div className="flex items-center justify-center gap-2 text-sm text-amber-600 dark:text-amber-400">
              <Info className="w-4 h-4" />
              {studentUpload.failedFiles} file(s) failed — you can proceed with {studentUpload.completedFiles} ready file(s)
            </div>
          )}
          
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <Button 
                    onClick={handleGenerateGrades} 
                    disabled={!canGenerate || shouldWaitForProcessing} 
                    className="w-full" 
                    size="lg"
                  >
                    {grading ? (
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    ) : (
                      <Sparkles className="w-5 h-5 mr-2" />
                    )}
                    {(() => {
                      // ELA: check if ELA rubric is provided
                      const elaHasRubric = gradingSubject === "ela" && elaRubricText.trim().length > 0;
                      // Math: check existing rubric detection
                      const hasRubricForGrading = gradingSubject === "math" ? rubricDetected : elaHasRubric;
                      
                      if (hasFailedFiles && studentUpload.hasReadyFiles) {
                        return "Proceed with Ready Files";
                      }
                      
                      if (studentGroups.length > 1) {
                        return hasRubricForGrading 
                          ? `Generate Grade + Feedback (${studentGroups.length})`
                          : `Generate Feedback (${studentGroups.length})`;
                      }
                      
                      return hasRubricForGrading
                        ? "Generate Grade + Feedback"
                        : "Generate Feedback";
                    })()}
                  </Button>
                </div>
              </TooltipTrigger>
              {shouldWaitForProcessing && (
                <TooltipContent>
                  <p>Waiting for text extraction to complete...</p>
                </TooltipContent>
              )}
              {!canGenerate && !shouldWaitForProcessing && !studentUpload.hasReadyFiles && (
                <TooltipContent>
                  <p>Upload student work files first</p>
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* ===== RESULTS ===== */}
        {currentGroup?.result && (
          <div className="space-y-4 animate-fade-in">
            {/* Student Selector Tabs */}
            {studentGroups.length > 1 && (
              <Card className="border border-muted">
                <CardContent className="p-3">
                  <div className="flex flex-wrap gap-2">
                    {studentGroups.map((group, idx) => (
                      <Button
                        key={group.studentName}
                        variant={idx === selectedGroupIndex ? "default" : "outline"}
                        size="sm"
                        onClick={() => setSelectedGroupIndex(idx)}
                      >
                        {group.studentName}
                        {group.result && <Check className="w-3 h-3 ml-1" />}
                      </Button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* ELA-Specific Results Display */}
            {gradingSubject === "ela" && elaResults.has(currentGroup.studentName) && (
              <ELAResultsDisplay
                result={elaResults.get(currentGroup.studentName)!}
                onCopy={handleCopy}
              />
            )}

            {/* Math Results - Suggested Score - Only shown when rubric was present (scoring mode) */}
            {gradingSubject === "math" && currentGroup.result.score_suggestion !== "N/A" && currentGroup.result.score_percent !== undefined && (
              <Card className="border-2 border-primary/30 shadow-lg bg-primary/5">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <span className="text-xl font-bold">{studentGroups.length > 1 ? `${currentGroup.studentName} — ` : ""}Score</span>
                      {/* Scoring source badge */}
                      <Badge variant="outline" className="text-xs bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-300">
                        <Lock className="w-3 h-3 mr-1" />
                        Rubric-based scoring
                      </Badge>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCopy(currentGroup.result!.score_suggestion, "Score")}
                    >
                      {copied === "Score" ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Large prominent score display */}
                  <div className="flex items-center gap-4 py-2">
                    <div className="flex items-baseline gap-2">
                      <Input
                        value={currentGroup.result.score_suggestion}
                        onChange={(e) => updateGroupResult(selectedGroupIndex, "score_suggestion", e.target.value)}
                        className="text-3xl font-bold text-primary max-w-36 h-14 text-center border-2 border-primary/20"
                      />
                    </div>
                    <div className="flex flex-col items-center">
                      <span className="text-4xl font-bold text-foreground">
                        {currentGroup.result.score_percent}%
                      </span>
                      {currentGroup.result.letter_grade && (
                        <Badge variant="secondary" className="text-xl px-4 py-1 mt-1 font-bold">
                          {currentGroup.result.letter_grade}
                        </Badge>
                      )}
                    </div>
                  </div>
                  {currentGroup.result.score_derivation && (
                    <p className="text-sm text-muted-foreground flex items-start gap-2">
                      <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      {currentGroup.result.score_derivation}
                    </p>
                  )}
                  {/* Confidence indicator */}
                  {currentGroup.result.confidence && currentGroup.result.confidence !== 'high' && (
                    <div className={`flex items-center gap-2 text-xs p-2 rounded-md ${
                      currentGroup.result.confidence === 'low' 
                        ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                        : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                    }`}>
                      <Info className="w-3 h-3" />
                      Confidence: {currentGroup.result.confidence} — teacher review recommended
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Math: Feedback-only mode header - shown when no rubric was used */}
            {gradingSubject === "math" && currentGroup.result.score_suggestion === "N/A" && (
              <Card className="border-2 border-blue-200 dark:border-blue-800 shadow-lg bg-blue-50 dark:bg-blue-900/20">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <span className="text-xl font-bold">{studentGroups.length > 1 ? `${currentGroup.studentName} — ` : ""}Feedback</span>
                    <Badge variant="outline" className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-300">
                      Feedback-only mode
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-blue-700 dark:text-blue-300">
                    No numeric score generated. Add a rubric to enable scoring for future assignments.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Math: Quick Summary - Strengths & Areas for Improvement headers (always visible for Math) */}
            {gradingSubject === "math" && (
            <Card className="border-0 shadow-md">
              <CardContent className="p-4 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Strengths Summary */}
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      <span className="text-sm font-medium text-foreground">Strengths</span>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {currentGroup.result.strengths?.slice(0, 100) || "See detailed feedback"}
                      {(currentGroup.result.strengths?.length || 0) > 100 ? "..." : ""}
                    </p>
                  </div>
                  
                  {/* Areas for Improvement Summary */}
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Info className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                      <span className="text-sm font-medium text-foreground">Areas for Improvement</span>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {currentGroup.result.areas_for_improvement?.slice(0, 100) || "See detailed feedback"}
                      {(currentGroup.result.areas_for_improvement?.length || 0) > 100 ? "..." : ""}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            )}

            {/* ===== DETAILED FEEDBACK (Collapsible - closed by default) - Math only ===== */}
            {gradingSubject === "math" && (
            <Collapsible open={feedbackExpanded} onOpenChange={setFeedbackExpanded}>
              <Card className="border shadow-md">
                <CollapsibleTrigger asChild>
                  <CardHeader className="cursor-pointer hover:bg-muted/20 transition-colors rounded-t-lg pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <FileText className="w-5 h-5 text-muted-foreground" />
                        <CardTitle className="text-base font-medium">
                          View Detailed Feedback
                        </CardTitle>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-xs">
                          {feedbackExpanded ? "Collapse" : "Expand"}
                        </Badge>
                        <ChevronDown className={`w-5 h-5 text-muted-foreground transition-transform duration-200 ${
                          feedbackExpanded ? "rotate-180" : ""
                        }`} />
                      </div>
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>
                
                <CollapsibleContent>
                  <CardContent className="space-y-4 pt-0">
                    {/* Strengths - Full */}
                    <div className="space-y-2">
                      <Label className="text-sm font-medium flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                        Strengths
                      </Label>
                      <Textarea
                        value={currentGroup.result.strengths}
                        onChange={(e) => updateGroupResult(selectedGroupIndex, "strengths", e.target.value)}
                        rows={3}
                      />
                    </div>
                    
                    {/* Areas for Improvement - Full */}
                    <div className="space-y-2">
                      <Label className="text-sm font-medium flex items-center gap-2">
                        <Info className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                        Areas for Improvement
                      </Label>
                      <Textarea
                        value={currentGroup.result.areas_for_improvement}
                        onChange={(e) => updateGroupResult(selectedGroupIndex, "areas_for_improvement", e.target.value)}
                        rows={3}
                      />
                    </div>
                    
                    {/* Draft Feedback - Full */}
                    <div className="space-y-2">
                      <Label className="text-sm font-medium flex items-center gap-2">
                        <FileText className="w-4 h-4 text-primary" />
                        Draft Feedback for Student
                      </Label>
                      <Textarea
                        value={currentGroup.result.feedback_paragraph}
                        onChange={(e) => updateGroupResult(selectedGroupIndex, "feedback_paragraph", e.target.value)}
                        rows={5}
                      />
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
            )}

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-3">
              <Button
                variant="outline"
                onClick={handleDownloadPdf}
                disabled={downloadingPdf}
                className="flex-1 min-w-[140px]"
              >
                {downloadingPdf ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Download className="w-4 h-4 mr-2" />
                )}
                Download PDF
              </Button>
              <Button variant="ghost" onClick={handlePrintReport} className="min-w-[120px]">
                <Printer className="w-4 h-4 mr-2" />
                Print Report
              </Button>
              <Button onClick={handleSave} disabled={saving} className="flex-1 min-w-[100px]">
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                {sessionId ? "Update" : "Save"}
              </Button>
            </div>
          </div>
        )}
      </main>

      {/* Pilot Feedback Panel - slides in from bottom-right */}
      <PilotFeedbackPanel
        show={showFeedback}
        onDismiss={dismissFeedback}
        onSkip={skipFeedback}
      />

      {/* Grouping Review Modal - for multi-page safety */}
      <GroupingReviewModal
        open={groupingReviewOpen}
        onOpenChange={setGroupingReviewOpen}
        groups={pendingGroupsForReview}
        onConfirm={handleGroupingConfirmed}
        onCancel={handleGroupingCancelled}
      />

    </div>
  );
}
