
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS selfie_path TEXT,
  ADD COLUMN IF NOT EXISTS kyc_completed BOOLEAN NOT NULL DEFAULT false;

CREATE POLICY "Users read own selfies"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'kyc-selfies' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users upload own selfies"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'kyc-selfies' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users update own selfies"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'kyc-selfies' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users delete own selfies"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'kyc-selfies' AND auth.uid()::text = (storage.foldername(name))[1]);
