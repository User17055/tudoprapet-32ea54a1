CREATE TABLE public.attribute_keys (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.attribute_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view attribute_keys" ON public.attribute_keys FOR SELECT USING (true);
CREATE POLICY "Admins can insert attribute_keys" ON public.attribute_keys FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update attribute_keys" ON public.attribute_keys FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete attribute_keys" ON public.attribute_keys FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- Seed with any existing keys already used in attribute_values / product_attributes
INSERT INTO public.attribute_keys (name)
SELECT DISTINCT attr_key FROM public.attribute_values
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.attribute_keys (name)
SELECT DISTINCT attr_key FROM public.product_attributes
ON CONFLICT (name) DO NOTHING;