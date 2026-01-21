-- Create sessions table for storing lesson recordings and summaries
CREATE TABLE public.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'recording' CHECK (status IN ('recording', 'uploading', 'processing', 'completed', 'failed')),
  duration_seconds integer,
  audio_path text,
  transcript text,
  summary_json jsonb,
  teacher_notes text,
  parent_message_draft text,
  title text,
  snippet text,
  error_message text
);

-- Enable Row Level Security
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

-- Users can only read their own sessions
CREATE POLICY "Users can view their own sessions"
ON public.sessions
FOR SELECT
USING (auth.uid() = user_id);

-- Users can create their own sessions
CREATE POLICY "Users can create their own sessions"
ON public.sessions
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can update their own sessions
CREATE POLICY "Users can update their own sessions"
ON public.sessions
FOR UPDATE
USING (auth.uid() = user_id);

-- Users can delete their own sessions
CREATE POLICY "Users can delete their own sessions"
ON public.sessions
FOR DELETE
USING (auth.uid() = user_id);

-- Create index for faster queries
CREATE INDEX idx_sessions_user_id ON public.sessions(user_id);
CREATE INDEX idx_sessions_created_at ON public.sessions(created_at DESC);

-- Create storage bucket for audio files
INSERT INTO storage.buckets (id, name, public)
VALUES ('bottor-audio', 'bottor-audio', false);

-- Storage policies: Users can only access their own audio files
CREATE POLICY "Users can upload their own audio"
ON storage.objects
FOR INSERT
WITH CHECK (bucket_id = 'bottor-audio' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can view their own audio"
ON storage.objects
FOR SELECT
USING (bucket_id = 'bottor-audio' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete their own audio"
ON storage.objects
FOR DELETE
USING (bucket_id = 'bottor-audio' AND auth.uid()::text = (storage.foldername(name))[1]);