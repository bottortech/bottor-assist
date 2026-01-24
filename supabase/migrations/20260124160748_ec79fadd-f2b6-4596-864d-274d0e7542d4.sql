-- Create storage bucket for grade reports
INSERT INTO storage.buckets (id, name, public)
VALUES ('grade-reports', 'grade-reports', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload their own grade reports
CREATE POLICY "Users can upload their own grade reports"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'grade-reports' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Allow authenticated users to view their own grade reports
CREATE POLICY "Users can view their own grade reports"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'grade-reports'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Allow public access to grade reports (for sharing links)
CREATE POLICY "Public can view grade reports via direct link"
ON storage.objects
FOR SELECT
USING (bucket_id = 'grade-reports');