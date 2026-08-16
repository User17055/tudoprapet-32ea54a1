CREATE OR REPLACE FUNCTION public.guard_profile_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF public.has_role(auth.uid(), 'admin') OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.is_franchisee := false;
  ELSIF NEW.is_franchisee IS DISTINCT FROM OLD.is_franchisee THEN
    RAISE EXCEPTION 'not_allowed_to_change_is_franchisee';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_profiles_privileged_columns ON public.profiles;
CREATE TRIGGER guard_profiles_privileged_columns
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_privileged_columns();