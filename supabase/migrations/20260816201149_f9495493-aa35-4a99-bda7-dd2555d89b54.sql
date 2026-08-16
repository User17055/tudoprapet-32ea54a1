GRANT SELECT ON public.site_maintenance TO anon;
GRANT SELECT, UPDATE ON public.site_maintenance TO authenticated;
GRANT ALL ON public.site_maintenance TO service_role;