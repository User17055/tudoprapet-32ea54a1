CREATE TABLE public.user_carts (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  cart_id TEXT,
  checkout_url TEXT,
  discount_code TEXT,
  has_auto_opened_cart BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_carts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own cart"
  ON public.user_carts FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own cart"
  ON public.user_carts FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own cart"
  ON public.user_carts FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own cart"
  ON public.user_carts FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER update_user_carts_updated_at
  BEFORE UPDATE ON public.user_carts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
