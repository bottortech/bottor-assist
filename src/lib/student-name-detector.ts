/**
 * Student Name Detection Utility
 * 
 * Detects student names from extracted text using common patterns:
 * - "Student Name: [name]"
 * - "Name: [name]"
 * - Full name near the top of the document
 * 
 * Returns null if no name is detected, indicating the file should be marked as "Ungrouped"
 */

export interface DetectedStudentName {
  name: string;
  confidence: 'high' | 'medium' | 'low';
  source: 'label' | 'header' | 'pattern';
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

  // Try to find name in header (first 5 lines)
  const lines = text.split('\n').slice(0, 8).map(l => l.trim()).filter(l => l.length > 0);
  
  for (const line of lines) {
    // Skip lines that look like dates, page numbers, or titles
    if (/^\d/.test(line)) continue;
    if (/page\s*\d/i.test(line)) continue;
    if (line.length > 60) continue; // Too long to be just a name
    
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
 * Normalize a student name for comparison
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
