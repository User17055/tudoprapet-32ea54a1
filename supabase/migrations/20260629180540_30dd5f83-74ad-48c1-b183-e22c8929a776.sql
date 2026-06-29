
CREATE TABLE public.hero_banners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_path TEXT NOT NULL,
  link_url TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.hero_banners TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.hero_banners TO authenticated;
GRANT ALL ON public.hero_banners TO service_role;
ALTER TABLE public.hero_banners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view active banners" ON public.hero_banners FOR SELECT USING (true);
CREATE POLICY "Admins manage banners" ON public.hero_banners FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY "Public read banners storage" ON storage.objects FOR SELECT USING (bucket_id = 'banners');
CREATE POLICY "Admins upload banners" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id='banners' AND public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins update banners" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id='banners' AND public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins delete banners" ON storage.objects FOR DELETE TO authenticated USING (bucket_id='banners' AND public.has_role(auth.uid(),'admin'));
