CREATE TABLE public.site_maintenance (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  enabled boolean NOT NULL DEFAULT false,
  ends_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT site_maintenance_enabled_requires_end
    CHECK (NOT enabled OR ends_at IS NOT NULL)
);

ALTER TABLE public.site_maintenance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view site maintenance"
  ON public.site_maintenance FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Admins can update site maintenance"
  ON public.site_maintenance FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.site_maintenance (id, enabled) VALUES (true, false);

CREATE TRIGGER update_site_maintenance_updated_at
  BEFORE UPDATE ON public.site_maintenance
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.site_maintenance;
