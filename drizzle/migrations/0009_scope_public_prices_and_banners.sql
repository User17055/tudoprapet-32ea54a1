DROP POLICY IF EXISTS "Anyone can view customer prices" ON public.customer_prices;
CREATE POLICY "Public can view prices of customer-facing products" ON public.customer_prices
  FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.product_audience a
                 WHERE a.shopify_product_id = customer_prices.shopify_product_id
                   AND a.audience IN ('cliente','ambos')));
CREATE POLICY "Admins can view all customer prices" ON public.customer_prices
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Public read banners storage" ON storage.objects;
CREATE POLICY "Public read active banner images" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'banners' AND EXISTS (
    SELECT 1 FROM public.hero_banners b
    WHERE b.active
      AND (storage.objects.name = b.image_path
        OR storage.objects.name = regexp_replace(b.image_path, '/mobile(\.[^.]+)$', '/desktop\1', 'i'))));
CREATE POLICY "Admins read banners storage" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'banners' AND public.has_role(auth.uid(), 'admin'));