
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS acquisition_source TEXT,
  ADD COLUMN IF NOT EXISTS referral_code TEXT;
