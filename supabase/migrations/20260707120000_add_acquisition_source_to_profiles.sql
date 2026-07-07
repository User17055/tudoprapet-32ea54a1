ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS acquisition_source TEXT,
ADD COLUMN IF NOT EXISTS referral_code TEXT;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (
    user_id,
    email,
    name,
    acquisition_source,
    referral_code
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name'),
    NEW.raw_user_meta_data->>'acquisition_source',
    NULLIF(NEW.raw_user_meta_data->>'referral_code', '')
  )
  ON CONFLICT (user_id) DO UPDATE SET
    acquisition_source = COALESCE(public.profiles.acquisition_source, EXCLUDED.acquisition_source),
    referral_code = COALESCE(public.profiles.referral_code, EXCLUDED.referral_code);
  RETURN NEW;
END;
$$;
