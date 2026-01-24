/**
 * =============================================================================
 * FEATURE FLAGS
 * =============================================================================
 * 
 * Centralized feature flag configuration for the application.
 * Toggle these flags to enable/disable features during development and pilot.
 * 
 * USAGE: import { FEATURE_FLAGS } from '@/lib/feature-flags';
 *        if (FEATURE_FLAGS.ENABLE_PDF_DOWNLOAD) { ... }
 * =============================================================================
 */

export const FEATURE_FLAGS = {
  /**
   * PILOT_MODE: When true, disables actual PDF generation and storage.
   * Users see a preview instead and can use browser print dialog.
   * Set to false for full release to enable real PDF downloads.
   */
  PILOT_MODE: true,

  /**
   * ENABLE_PDF_DOWNLOAD: When true, enables server-side PDF generation
   * and storage to Supabase. Automatically disabled when PILOT_MODE is true.
   */
  ENABLE_PDF_DOWNLOAD: false,

  /**
   * ENABLE_SAVED_REPORTS: When true, allows saving reports to the database
   * with storage URLs. Automatically disabled when PILOT_MODE is true.
   */
  ENABLE_SAVED_REPORTS: false,
} as const;

/**
 * Helper to check if we should use pilot mode behavior
 */
export function isPilotMode(): boolean {
  return FEATURE_FLAGS.PILOT_MODE;
}

/**
 * Helper to check if PDF download is enabled
 */
export function isPdfDownloadEnabled(): boolean {
  return !FEATURE_FLAGS.PILOT_MODE && FEATURE_FLAGS.ENABLE_PDF_DOWNLOAD;
}
