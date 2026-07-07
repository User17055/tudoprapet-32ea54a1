CREATE TABLE public.employee_referral_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  employee_name TEXT NOT NULL,
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

CREATE POLICY "Admins can manage referral codes"
ON public.employee_referral_codes FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_employee_referral_codes_updated_at
BEFORE UPDATE ON public.employee_referral_codes
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
