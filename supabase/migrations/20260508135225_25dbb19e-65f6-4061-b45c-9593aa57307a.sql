-- Grant admin to marco@saofrancisco.ver.br if user exists now
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::app_role FROM auth.users WHERE email = 'marco@saofrancisco.ver.br'
ON CONFLICT DO NOTHING;

-- Trigger to auto-grant admin when this email signs up later
CREATE OR REPLACE FUNCTION public.grant_admin_to_marco()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email = 'marco@saofrancisco.ver.br' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin'::app_role)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS grant_admin_to_marco_trigger ON auth.users;
CREATE TRIGGER grant_admin_to_marco_trigger
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.grant_admin_to_marco();