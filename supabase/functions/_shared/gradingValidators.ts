/**
 * Shared grading validators used by grade-paper and grade-ela.
 * These run AFTER the model returns JSON and BEFORE the response
 * is sent back, to enforce rubric fidelity and self-consistency.
 *
 * NOTE: Edge functions can't share files at runtime in Deno, so each
 * function inlines a copy. This file is the canonical source of truth.
 */
export {};
