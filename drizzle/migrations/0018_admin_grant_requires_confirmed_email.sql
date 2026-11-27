CREATE OR REPLACE FUNCTION public.grant_admin_to_marco()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL
     AND lower(NEW.email) IN ('mariaeduarda@saofranciscopet.com.br') THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin'::app_role)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS grant_admin_to_marco_confirm_trigger ON auth.users;
CREATE TRIGGER grant_admin_to_marco_confirm_trigger
AFTER UPDATE OF email_confirmed_at ON auth.users
FOR EACH ROW
WHEN (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
EXECUTE FUNCTION public.grant_admin_to_marco();