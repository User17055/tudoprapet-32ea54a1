CREATE TABLE public.attribute_values (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  attr_key TEXT NOT NULL,
  attr_value TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (attr_key, attr_value)
);

ALTER TABLE public.attribute_values ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view attribute_values" ON public.attribute_values FOR SELECT USING (true);
CREATE POLICY "Admins can insert attribute_values" ON public.attribute_values FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update attribute_values" ON public.attribute_values FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete attribute_values" ON public.attribute_values FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_attribute_values_key ON public.attribute_values (attr_key, sort_order);