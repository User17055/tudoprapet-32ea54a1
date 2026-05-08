-- Corrigir email para .vet.br
CREATE OR REPLACE FUNCTION public.grant_admin_to_marco()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.email = 'marco@saofrancisco.vet.br' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin'::app_role)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;

-- Conceder admin se já existir o usuário com email correto
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::app_role FROM auth.users WHERE email = 'marco@saofrancisco.vet.br'
ON CONFLICT DO NOTHING;

-- Remover role admin do email errado, se houver
DELETE FROM public.user_roles
WHERE role = 'admin'::app_role
  AND user_id IN (SELECT id FROM auth.users WHERE email = 'marco@saofrancisco.ver.br');