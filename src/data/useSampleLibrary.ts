/**
 * =============================================================================
 * SAMPLE GRADING LIBRARY HOOK
 * =============================================================================
 * 
 * Provides typed access to the sample grading library data.
 * Supports filtering by subject, grade band, and assignment type.
 * =============================================================================
 */

import { useMemo } from "react";
import type { SampleGradingLibrary, GradingSample } from "@/types/sampleLibrary";
import rawLibrary from "./sample-grading-library.json";

const library = rawLibrary as SampleGradingLibrary;

interface SampleFilters {
  subject?: string;
  gradeBand?: string;
}

export function useSampleLibrary(filters?: SampleFilters) {
  const samples = useMemo(() => {
    let result: GradingSample[] = library.samples;
    if (filters?.subject) {
      result = result.filter(s => s.subject === filters.subject);
    }
    if (filters?.gradeBand) {
      result = result.filter(s => s.gradeBand.includes(filters.gradeBand!));
    }
    return result;
  }, [filters?.subject, filters?.gradeBand]);

  return {
    meta: library.meta,
    samples,
    allSamples: library.samples,
    getSampleById: (id: string) => library.samples.find(s => s.id === id),
    subjects: library.meta.subjects,
    gradeBands: library.meta.gradeBands,
  };
}
