DROP POLICY IF EXISTS "Anyone can view subscriber category margins" ON public.subscriber_category_margins;
REVOKE SELECT ON public.subscriber_category_margins FROM anon;