/**
 * Student Name Detection & Grouping Utility
 * 
 * Detects student names from filenames and extracted text.
 * Also parses assignment IDs for grouping multi-page submissions.
 * 
 * Auto-grouping rules:
 * 1. Parse assignmentId from filename (first token before _ or - that matches patterns like Lesson4, Assignment1)
 * 2. Detect student name from filename patterns (JordanMiller, Jordan_Miller, Jordan-Miller)
 * 3. If not in filename, detect from extracted text (Name:, Student:, Student Name:)
 * 4. If still not found, set studentName = "Unknown Student" and mark needs_review = true
 * 5. groupKey = assignmentId + "::" + normalizedStudentName
 */

export interface DetectedStudentName {
  name: string;
  confidence: 'high' | 'medium' | 'low';
  source: 'filename' | 'label' | 'header' | 'pattern';
}

export interface ParsedFileInfo {
  assignmentId: string;
  studentName: string | null;
  pageNumber: number | null;
  groupKey: string;
  needsReview: boolean;
}

/**
 * Common name patterns to look for in text
 */
const NAME_LABEL_PATTERNS = [
  /student\s*name\s*[:=]\s*([A-Za-z][A-Za-z\s'-]{1,40})/i,
  /name\s*[:=]\s*([A-Za-z][A-Za-z\s'-]{1,40})/i,
  /student\s*[:=]\s*([A-Za-z][A-Za-z\s'-]{1,40})/i,
  /by\s*[:=]?\s*([A-Za-z][A-Za-z\s'-]{1,40})/i,
  /submitted\s*by\s*[:=]?\s*([A-Za-z][A-Za-z\s'-]{1,40})/i,
];

/**
 * Patterns for names in header position (first few lines)
 * Match "FirstName LastName" pattern at start of line
 */
const HEADER_NAME_PATTERN = /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*$/;

/**
 * Pattern for "Last, First" format
 */
const LAST_FIRST_PATTERN = /^([A-Z][a-z]+),\s*([A-Z][a-z]+)$/;

/**
 * Assignment ID patterns (Lesson4, Lesson4_Functions, Assignment1, etc.)
 */
const ASSIGNMENT_ID_PATTERNS = [
  /^(lesson\d+)/i,
  /^(assignment\d+)/i,
  /^(unit\d+)/i,
  /^(chapter\d+)/i,
  /^(module\d+)/i,
  /^(hw\d+)/i,
  /^(worksheet\d+)/i,
  /^(quiz\d+)/i,
  /^(test\d+)/i,
  /^(exam\d+)/i,
];

/**
 * Common words that should NOT be treated as names
 */
const EXCLUDED_WORDS = new Set([
  'page', 'assignment', 'homework', 'quiz', 'test', 'exam', 'worksheet',
  'grade', 'class', 'period', 'date', 'due', 'subject', 'math', 'english',
  'science', 'history', 'reading', 'writing', 'social', 'studies', 'art',
  'music', 'name', 'student', 'teacher', 'school', 'total', 'score', 'points',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december', 'monday', 'tuesday',
  'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'source', 'document',
  'lesson', 'unit', 'chapter', 'module', 'final', 'midterm',
]);

/**
 * Check if a potential name is valid
 */
function isValidName(name: string): boolean {
  if (!name || name.length < 2) return false;
  
  // Clean up the name
  const cleaned = name.trim()
    .replace(/[^A-Za-z\s'-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  
  if (cleaned.length < 2 || cleaned.length > 50) return false;
  
  // Split into words
  const words = cleaned.toLowerCase().split(/\s+/);
  
  // Check if any word is an excluded word
  if (words.some(word => EXCLUDED_WORDS.has(word))) {
    return false;
  }
  
  // Must have at least 2 characters that aren't spaces
  if (cleaned.replace(/\s/g, '').length < 2) return false;
  
  // Should have alphabetic characters
  if (!/[A-Za-z]/.test(cleaned)) return false;
  
  return true;
}

/**
 * Clean and format a detected name
 */
function formatName(name: string): string {
  return name
    .trim()
    .replace(/[^A-Za-z\s'-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Parse assignment ID from the beginning of a filename
 * Returns the assignment ID or "default" if none found
 */
export function parseAssignmentIdFromFilename(filename: string): string {
  // Remove extension
  const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');
  
  // Split by _ or - to get first token(s)
  const tokens = nameWithoutExt.split(/[_-]/);
  
  if (tokens.length === 0) return 'default';
  
  const firstToken = tokens[0].trim();
  
  // Check if first token matches any assignment pattern
  for (const pattern of ASSIGNMENT_ID_PATTERNS) {
    const match = firstToken.match(pattern);
    if (match) {
      return match[1].toLowerCase();
    }
  }
  
  // If first token looks like an assignment (contains numbers and letters)
  if (/^[a-zA-Z]+\d+/.test(firstToken)) {
    return firstToken.toLowerCase();
  }
  
  return 'default';
}

/**
 * Try to extract student name from filename
 * Patterns: JordanMiller, Jordan_Miller, Jordan-Miller, Miller_Jordan
 */
export function parseStudentNameFromFilename(filename: string): string | null {
  // Remove extension
  const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');
  
  // Split by common separators
  const tokens = nameWithoutExt.split(/[_\-\s]+/);
  
  // Skip first token if it looks like assignment ID
  let startIndex = 0;
  for (const pattern of ASSIGNMENT_ID_PATTERNS) {
    if (pattern.test(tokens[0] || '')) {
      startIndex = 1;
      break;
    }
  }
  
  // Skip tokens that look like page numbers
  const filteredTokens = tokens.slice(startIndex).filter(token => {
    const lower = token.toLowerCase();
    // Skip page indicators
    if (/^p\d+$/.test(lower) || /^page\d+$/.test(lower) || /^\d+$/.test(lower)) {
      return false;
    }
    // Skip common file suffixes
    if (EXCLUDED_WORDS.has(lower)) {
      return false;
    }
    return true;
  });
  
  if (filteredTokens.length === 0) return null;
  
  // Try CamelCase pattern (JordanMiller -> Jordan Miller)
  if (filteredTokens.length === 1) {
    const camelMatch = filteredTokens[0].match(/^([A-Z][a-z]+)([A-Z][a-z]+)$/);
    if (camelMatch) {
      const name = `${camelMatch[1]} ${camelMatch[2]}`;
      if (isValidName(name)) {
        return formatName(name);
      }
    }
  }
  
  // Try combining remaining tokens as name parts
  if (filteredTokens.length >= 2) {
    // Take first two tokens as First Last
    const potentialName = filteredTokens.slice(0, 2).join(' ');
    if (isValidName(potentialName)) {
      return formatName(potentialName);
    }
  }
  
  // Single token might be a last name or full name
  if (filteredTokens.length === 1 && filteredTokens[0].length > 2) {
    const token = filteredTokens[0];
    // Check for camelcase
    const parts = token.split(/(?=[A-Z])/);
    if (parts.length >= 2) {
      const name = parts.join(' ');
      if (isValidName(name)) {
        return formatName(name);
      }
    }
  }
  
  return null;
}

/**
 * Parse page number from filename
 * Patterns: p1, p2, Page1, Page2, _1, -1 (at end)
 */
export function parsePageNumberFromFilename(filename: string): number | null {
  const nameWithoutExt = filename.replace(/\.[^/.]+$/, '').toLowerCase();
  
  // Try common page patterns
  const patterns = [
    /(?:^|[_\-\s])p(?:age)?(\d+)(?:[_\-\s]|$)/i,  // p1, page1, _p1_, -page1-
    /(?:^|[_\-\s])(\d+)$/,                         // ends with number
  ];
  
  for (const pattern of patterns) {
    const match = nameWithoutExt.match(pattern);
    if (match && match[1]) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > 0 && num < 100) {
        return num;
      }
    }
  }
  
  return null;
}

/**
 * Detect student name from extracted text
 * 
 * @param text - The extracted text from the document
 * @returns DetectedStudentName or null if no name found
 */
export function detectStudentName(text: string): DetectedStudentName | null {
  if (!text || text.trim().length === 0) {
    return null;
  }

  // Try labeled patterns first (highest confidence)
  for (const pattern of NAME_LABEL_PATTERNS) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const name = formatName(match[1]);
      if (isValidName(name)) {
        return {
          name,
          confidence: 'high',
          source: 'label',
        };
      }
    }
  }

  // Try to find name in header (first 25 lines as specified)
  const lines = text.split('\n').slice(0, 25).map(l => l.trim()).filter(l => l.length > 0);
  
  for (const line of lines) {
    // Skip lines that look like dates, page numbers, or titles
    if (/^\d/.test(line)) continue;
    if (/page\s*\d/i.test(line)) continue;
    if (line.length > 60) continue; // Too long to be just a name
    
    // Try "Last, First" format
    const lastFirstMatch = line.match(LAST_FIRST_PATTERN);
    if (lastFirstMatch) {
      const name = formatName(`${lastFirstMatch[2]} ${lastFirstMatch[1]}`);
      if (isValidName(name)) {
        return {
          name,
          confidence: 'medium',
          source: 'header',
        };
      }
    }
    
    // Try standard header name pattern
    const match = line.match(HEADER_NAME_PATTERN);
    if (match && match[1]) {
      const name = formatName(match[1]);
      if (isValidName(name) && name.split(' ').length >= 2) {
        return {
          name,
          confidence: 'medium',
          source: 'header',
        };
      }
    }
  }

  // No name detected
  return null;
}

/**
 * Normalize a student name for comparison (used as part of groupKey)
 * - trim, lowercase, remove punctuation, collapse multiple spaces
 */
export function normalizeStudentName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check if two student names match (case-insensitive, ignoring punctuation)
 */
export function studentNamesMatch(name1: string, name2: string): boolean {
  return normalizeStudentName(name1) === normalizeStudentName(name2);
}

/**
 * Parse complete file info for grouping
 * Combines filename parsing + text detection
 */
export function parseFileInfo(filename: string, extractedText?: string): ParsedFileInfo {
  const assignmentId = parseAssignmentIdFromFilename(filename);
  let studentName = parseStudentNameFromFilename(filename);
  const pageNumber = parsePageNumberFromFilename(filename);
  let needsReview = false;
  
  // If no name from filename, try from extracted text
  if (!studentName && extractedText) {
    const detected = detectStudentName(extractedText);
    if (detected) {
      studentName = detected.name;
    }
  }
  
  // If still no name, mark as needing review
  if (!studentName) {
    studentName = 'Unknown Student';
    needsReview = true;
  }
  
  const normalizedName = normalizeStudentName(studentName);
  const groupKey = `${assignmentId}::${normalizedName}`;
  
  return {
    assignmentId,
    studentName,
    pageNumber,
    groupKey,
    needsReview,
  };
}

/**
 * Detect if multiple different student names appear in text
 * Used for safety check when only 1 groupKey but multiple names detected
 */
export function detectMultipleStudentsInText(text: string): string[] {
  const detectedNames: Set<string> = new Set();
  
  if (!text || text.trim().length === 0) {
    return [];
  }
  
  // Check for labeled patterns throughout the document
  for (const pattern of NAME_LABEL_PATTERNS) {
    const regex = new RegExp(pattern.source, 'gi');
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (match[1]) {
        const name = formatName(match[1]);
        if (isValidName(name)) {
          detectedNames.add(normalizeStudentName(name));
        }
      }
    }
  }
  
  return Array.from(detectedNames);
}
