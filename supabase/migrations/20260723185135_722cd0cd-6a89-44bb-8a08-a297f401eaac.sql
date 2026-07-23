
-- 1. profiles: add is_franchisee
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_franchisee boolean NOT NULL DEFAULT false;

-- 2. product_audience
CREATE TABLE IF NOT EXISTS public.product_audience (
  shopify_product_id text PRIMARY KEY,
  audience text NOT NULL DEFAULT 'cliente' CHECK (audience IN ('cliente','franquia','ambos')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.product_audience TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_audience TO authenticated;
GRANT ALL ON public.product_audience TO service_role;

ALTER TABLE public.product_audience ENABLE ROW LEVEL SECURITY;

CREATE POLICY "product_audience readable by all"
  ON public.product_audience FOR SELECT
  USING (true);

CREATE POLICY "product_audience admin insert"
  ON public.product_audience FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "product_audience admin update"
  ON public.product_audience FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "product_audience admin delete"
  ON public.product_audience FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER product_audience_updated_at
  BEFORE UPDATE ON public.product_audience
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. franchise_prices
CREATE TABLE IF NOT EXISTS public.franchise_prices (
  shopify_variant_id text PRIMARY KEY,
  shopify_product_id text NOT NULL,
  price numeric NOT NULL CHECK (price >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.franchise_prices TO authenticated;
GRANT ALL ON public.franchise_prices TO service_role;

ALTER TABLE public.franchise_prices ENABLE ROW LEVEL SECURITY;

-- Helper: is current user a franchisee?
CREATE OR REPLACE FUNCTION public.is_franchisee(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT is_franchisee FROM public.profiles WHERE user_id = _user_id), false)
$$;

CREATE POLICY "franchise_prices readable by franchisees and admins"
  ON public.franchise_prices FOR SELECT TO authenticated
  USING (public.is_franchisee(auth.uid()) OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "franchise_prices admin insert"
  ON public.franchise_prices FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "franchise_prices admin update"
  ON public.franchise_prices FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "franchise_prices admin delete"
  ON public.franchise_prices FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER franchise_prices_updated_at
  BEFORE UPDATE ON public.franchise_prices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Allow admins to update profiles.is_franchisee
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='profiles' AND policyname='Admins can update profiles'
  ) THEN
    CREATE POLICY "Admins can update profiles"
      ON public.profiles FOR UPDATE TO authenticated
      USING (public.has_role(auth.uid(), 'admin'))
      WITH CHECK (public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;
