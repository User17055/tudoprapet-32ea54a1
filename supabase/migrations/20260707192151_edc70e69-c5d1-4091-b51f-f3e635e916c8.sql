
CREATE TABLE public.employee_referral_codes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  employee_name TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.employee_referral_codes TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.employee_referral_codes TO authenticated;
GRANT ALL ON public.employee_referral_codes TO service_role;

ALTER TABLE public.employee_referral_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active referral codes"
  ON public.employee_referral_codes FOR SELECT
  USING (active = true OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert referral codes"
  ON public.employee_referral_codes FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update referral codes"
  ON public.employee_referral_codes FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete referral codes"
  ON public.employee_referral_codes FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_employee_referral_codes_updated_at
  BEFORE UPDATE ON public.employee_referral_codes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Grant admin to mariaeduarda if already registered
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::app_role FROM auth.users
WHERE email = 'mariaeduarda@saofranciscopet.com.br'
ON CONFLICT DO NOTHING;

-- Update trigger to also grant admin to mariaeduarda on signup
CREATE OR REPLACE FUNCTION public.grant_admin_to_marco()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.email IN ('marco@saofrancisco.vet.br', 'mariaeduarda@saofranciscopet.com.br') THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin'::app_role)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;
