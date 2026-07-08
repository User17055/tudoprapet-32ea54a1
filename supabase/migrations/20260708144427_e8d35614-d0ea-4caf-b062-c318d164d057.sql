CREATE TABLE public.pickup_codes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  shopify_order_id TEXT NOT NULL,
  shopify_order_number TEXT,
  code TEXT NOT NULL UNIQUE,
  customer_name TEXT,
  customer_phone TEXT,
  customer_email TEXT,
  status TEXT NOT NULL DEFAULT 'ready',
  whatsapp_sent_at TIMESTAMPTZ,
  whatsapp_error TEXT,
  picked_up_at TIMESTAMPTZ,
  picked_up_by UUID REFERENCES auth.users(id),
  raw_order JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.pickup_codes TO authenticated;
GRANT ALL ON public.pickup_codes TO service_role;

ALTER TABLE public.pickup_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view pickup codes"
ON public.pickup_codes FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update pickup codes"
ON public.pickup_codes FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_pickup_codes_order ON public.pickup_codes(shopify_order_id);
CREATE INDEX idx_pickup_codes_code ON public.pickup_codes(code);

CREATE TRIGGER update_pickup_codes_updated_at
BEFORE UPDATE ON public.pickup_codes
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();