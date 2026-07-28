CREATE TABLE public.product_variation_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.product_variation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.product_variation_groups(id) ON DELETE CASCADE,
  shopify_product_id text NOT NULL UNIQUE,
  shopify_product_handle text NOT NULL,
  shopify_product_title text NOT NULL,
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX product_variation_items_group_id_idx
  ON public.product_variation_items(group_id, sort_order);

GRANT SELECT ON public.product_variation_groups, public.product_variation_items TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_variation_groups, public.product_variation_items TO authenticated;
GRANT ALL ON public.product_variation_groups, public.product_variation_items TO service_role;

ALTER TABLE public.product_variation_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variation_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "product variation groups readable by all"
  ON public.product_variation_groups FOR SELECT
  USING (true);

CREATE POLICY "product variation groups admin insert"
  ON public.product_variation_groups FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "product variation groups admin update"
  ON public.product_variation_groups FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "product variation groups admin delete"
  ON public.product_variation_groups FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "product variation items readable by all"
  ON public.product_variation_items FOR SELECT
  USING (true);

CREATE POLICY "product variation items admin insert"
  ON public.product_variation_items FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "product variation items admin update"
  ON public.product_variation_items FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "product variation items admin delete"
  ON public.product_variation_items FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
