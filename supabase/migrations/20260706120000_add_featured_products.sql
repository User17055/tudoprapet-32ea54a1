CREATE TABLE public.featured_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shopify_product_id TEXT NOT NULL UNIQUE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.featured_products TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.featured_products TO authenticated;
GRANT ALL ON public.featured_products TO service_role;

ALTER TABLE public.featured_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view featured products"
ON public.featured_products FOR SELECT
USING (true);

CREATE POLICY "Admins can manage featured products"
ON public.featured_products FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_featured_products_updated_at
BEFORE UPDATE ON public.featured_products
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
