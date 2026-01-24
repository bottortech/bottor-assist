-- Create table for saved rubrics
CREATE TABLE public.saved_rubrics (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  subject TEXT,
  grade_level TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_used_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.saved_rubrics ENABLE ROW LEVEL SECURITY;

-- Create policies for user access
CREATE POLICY "Users can view their own saved rubrics" 
ON public.saved_rubrics 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own saved rubrics" 
ON public.saved_rubrics 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own saved rubrics" 
ON public.saved_rubrics 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own saved rubrics" 
ON public.saved_rubrics 
FOR DELETE 
USING (auth.uid() = user_id);

-- Create index for faster lookups
CREATE INDEX idx_saved_rubrics_user_id ON public.saved_rubrics(user_id);
CREATE INDEX idx_saved_rubrics_last_used ON public.saved_rubrics(user_id, last_used_at DESC);