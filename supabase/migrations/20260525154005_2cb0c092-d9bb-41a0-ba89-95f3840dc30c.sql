
DROP POLICY IF EXISTS "Anyone can view club members" ON public.club_members;

CREATE POLICY "Admins can view club members"
ON public.club_members
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.grant_admin_to_marco() FROM PUBLIC, anon, authenticated;
