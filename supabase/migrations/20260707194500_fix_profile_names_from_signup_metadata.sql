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
    NULLIF(
      COALESCE(
        NEW.raw_user_meta_data->>'name',
        NEW.raw_user_meta_data->>'full_name',
        trim(concat_ws(' ', NEW.raw_user_meta_data->>'first_name', NEW.raw_user_meta_data->>'last_name'))
      ),
      ''
    ),
    NEW.raw_user_meta_data->>'acquisition_source',
    NULLIF(NEW.raw_user_meta_data->>'referral_code', '')
  )
  ON CONFLICT (user_id) DO UPDATE SET
    name = COALESCE(
      public.profiles.name,
      EXCLUDED.name
    ),
    acquisition_source = COALESCE(public.profiles.acquisition_source, EXCLUDED.acquisition_source),
    referral_code = COALESCE(public.profiles.referral_code, EXCLUDED.referral_code);
  RETURN NEW;
END;
$$;

UPDATE public.profiles p
SET name = NULLIF(
  COALESCE(
    u.raw_user_meta_data->>'name',
    u.raw_user_meta_data->>'full_name',
    trim(concat_ws(' ', u.raw_user_meta_data->>'first_name', u.raw_user_meta_data->>'last_name'))
  ),
  ''
)
FROM auth.users u
WHERE p.user_id = u.id
  AND (p.name IS NULL OR trim(p.name) = '');
