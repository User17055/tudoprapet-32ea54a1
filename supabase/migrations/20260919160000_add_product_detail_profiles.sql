-- Perfis reutilizaveis para classificar varios produtos de uma vez.
CREATE TABLE public.product_detail_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  brand_id uuid REFERENCES public.brands(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.product_detail_profile_categories (
  profile_id uuid NOT NULL REFERENCES public.product_detail_profiles(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  PRIMARY KEY (profile_id, category_id)
);

CREATE TABLE public.product_detail_profile_attributes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.product_detail_profiles(id) ON DELETE CASCADE,
  attr_key text NOT NULL,
  attr_value text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  UNIQUE (profile_id, attr_key, attr_value)
);

ALTER TABLE public.product_detail_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_detail_profile_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_detail_profile_attributes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view product detail profiles"
ON public.product_detail_profiles FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can manage product detail profiles"
ON public.product_detail_profiles FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin')) WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can view product detail profile categories"
ON public.product_detail_profile_categories FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can manage product detail profile categories"
ON public.product_detail_profile_categories FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin')) WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can view product detail profile attributes"
ON public.product_detail_profile_attributes FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can manage product detail profile attributes"
ON public.product_detail_profile_attributes FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin')) WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_product_detail_profiles_updated_at
BEFORE UPDATE ON public.product_detail_profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Impede que a aplicacao em massa duplique o mesmo atributo no produto.
DELETE FROM public.product_attributes current_row
USING public.product_attributes duplicate_row
WHERE current_row.shopify_product_id = duplicate_row.shopify_product_id
  AND current_row.attr_key = duplicate_row.attr_key
  AND current_row.attr_value = duplicate_row.attr_value
  AND current_row.id > duplicate_row.id;

ALTER TABLE public.product_attributes
ADD CONSTRAINT product_attributes_product_key_value_unique
UNIQUE (shopify_product_id, attr_key, attr_value);
