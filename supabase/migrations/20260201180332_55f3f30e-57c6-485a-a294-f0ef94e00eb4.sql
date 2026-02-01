-- =============================================================================
-- Helper function for updated_at (create first)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- =============================================================================
-- SUBMISSIONS TABLE - Universal submission storage for grading
-- =============================================================================

-- Create submission source enum
CREATE TYPE public.submission_source AS ENUM (
  'upload',
  'google_classroom',
  'canvas',
  'manual_entry'
);

-- Create submission status enum
CREATE TYPE public.submission_status AS ENUM (
  'pending',
  'processing',
  'graded',
  'review_needed',
  'failed'
);

-- Main submissions table
CREATE TABLE public.submissions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  
  -- Student identification
  student_id TEXT,
  student_name TEXT NOT NULL,
  student_email TEXT,
  
  -- Source tracking
  source submission_source NOT NULL DEFAULT 'upload',
  source_metadata JSONB DEFAULT '{}'::jsonb,
  
  -- Content
  combined_text TEXT,
  pages JSONB DEFAULT '[]'::jsonb,
  
  -- Name detection
  name_detection JSONB DEFAULT '{}'::jsonb,
  date_detection JSONB,
  
  -- Grading result
  grading_result JSONB,
  
  -- Status
  status submission_status NOT NULL DEFAULT 'pending',
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own submissions"
ON public.submissions FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own submissions"
ON public.submissions FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own submissions"
ON public.submissions FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own submissions"
ON public.submissions FOR DELETE USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_submissions_user_id ON public.submissions(user_id);
CREATE INDEX idx_submissions_status ON public.submissions(status);
CREATE INDEX idx_submissions_created_at ON public.submissions(created_at DESC);

-- Update trigger
CREATE TRIGGER update_submissions_updated_at
BEFORE UPDATE ON public.submissions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================================
-- SUBMISSION_BATCHES TABLE
-- =============================================================================

CREATE TABLE public.submission_batches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  
  assignment_title TEXT,
  subject TEXT,
  grade_level TEXT,
  
  rubric_id UUID REFERENCES public.saved_rubrics(id) ON DELETE SET NULL,
  answer_key_text TEXT,
  
  total_count INTEGER NOT NULL DEFAULT 0,
  graded_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE
);

ALTER TABLE public.submission_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own submission batches"
ON public.submission_batches FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own submission batches"
ON public.submission_batches FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own submission batches"
ON public.submission_batches FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own submission batches"
ON public.submission_batches FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_submission_batches_user_id ON public.submission_batches(user_id);

-- Link submissions to batches
ALTER TABLE public.submissions 
ADD COLUMN batch_id UUID REFERENCES public.submission_batches(id) ON DELETE CASCADE;

CREATE INDEX idx_submissions_batch_id ON public.submissions(batch_id);