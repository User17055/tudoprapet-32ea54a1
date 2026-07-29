-- Drop public SELECT policy
DROP POLICY IF EXISTS "Anyone can view active referral codes" ON public.employee_referral_codes;

-- Admin-only SELECT
CREATE POLICY "Admins can view referral codes"
  ON public.employee_referral_codes FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Revoke public grants
REVOKE SELECT ON public.employee_referral_codes FROM anon;

-- Validation function (no employee data exposed)
CREATE OR REPLACE FUNCTION public.validate_referral_code(_code text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employee_referral_codes
    WHERE code = upper(trim(_code)) AND active = true
  )
$$;

GRANT EXECUTE ON FUNCTION public.validate_referral_code(text) TO anon, authenticated;