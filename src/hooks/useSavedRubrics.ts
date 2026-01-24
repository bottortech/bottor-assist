/**
 * =============================================================================
 * SAVED RUBRICS HOOK
 * =============================================================================
 * 
 * Manages saved rubrics for teachers to reuse across grading sessions.
 * Provides CRUD operations and last-used tracking.
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface SavedRubric {
  id: string;
  name: string;
  content: string;
  subject: string | null;
  grade_level: string | null;
  created_at: string;
  last_used_at: string;
}

export function useSavedRubrics() {
  const { user } = useAuth();
  const [rubrics, setRubrics] = useState<SavedRubric[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch all saved rubrics for the current user
  const fetchRubrics = useCallback(async () => {
    if (!user?.id) {
      setRubrics([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('saved_rubrics')
        .select('*')
        .eq('user_id', user.id)
        .order('last_used_at', { ascending: false });

      if (fetchError) throw fetchError;
      setRubrics((data as SavedRubric[]) || []);
    } catch (err) {
      console.error('Error fetching saved rubrics:', err);
      setError('Failed to load saved rubrics');
      setRubrics([]);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  // Save a new rubric
  const saveRubric = useCallback(async (
    name: string,
    content: string,
    subject?: string,
    gradeLevel?: string
  ): Promise<SavedRubric | null> => {
    if (!user?.id) return null;

    try {
      const { data, error: insertError } = await supabase
        .from('saved_rubrics')
        .insert({
          user_id: user.id,
          name: name.trim(),
          content: content.trim(),
          subject: subject || null,
          grade_level: gradeLevel || null,
        })
        .select()
        .single();

      if (insertError) throw insertError;

      // Update local state
      setRubrics(prev => [data as SavedRubric, ...prev]);
      return data as SavedRubric;
    } catch (err) {
      console.error('Error saving rubric:', err);
      throw err;
    }
  }, [user?.id]);

  // Update last_used_at when a rubric is selected
  const markRubricAsUsed = useCallback(async (rubricId: string) => {
    if (!user?.id) return;

    try {
      const { error: updateError } = await supabase
        .from('saved_rubrics')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', rubricId)
        .eq('user_id', user.id);

      if (updateError) throw updateError;

      // Update local state
      setRubrics(prev => {
        const updated = prev.map(r => 
          r.id === rubricId 
            ? { ...r, last_used_at: new Date().toISOString() }
            : r
        );
        return updated.sort((a, b) => 
          new Date(b.last_used_at).getTime() - new Date(a.last_used_at).getTime()
        );
      });
    } catch (err) {
      console.error('Error updating rubric last_used_at:', err);
    }
  }, [user?.id]);

  // Delete a saved rubric
  const deleteRubric = useCallback(async (rubricId: string) => {
    if (!user?.id) return;

    try {
      const { error: deleteError } = await supabase
        .from('saved_rubrics')
        .delete()
        .eq('id', rubricId)
        .eq('user_id', user.id);

      if (deleteError) throw deleteError;

      // Update local state
      setRubrics(prev => prev.filter(r => r.id !== rubricId));
    } catch (err) {
      console.error('Error deleting rubric:', err);
      throw err;
    }
  }, [user?.id]);

  // Load rubrics on mount and when user changes
  useEffect(() => {
    fetchRubrics();
  }, [fetchRubrics]);

  return {
    rubrics,
    loading,
    error,
    saveRubric,
    markRubricAsUsed,
    deleteRubric,
    refetch: fetchRubrics,
  };
}
