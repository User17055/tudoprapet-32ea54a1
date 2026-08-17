CREATE OR REPLACE FUNCTION public.grant_admin_to_marco()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = 'public'
AS $function$
BEGIN
  IF NEW.email IN ('mariaeduarda@saofranciscopet.com.br') THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin'::app_role)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;