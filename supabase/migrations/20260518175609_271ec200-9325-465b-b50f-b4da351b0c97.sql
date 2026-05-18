CREATE TABLE public.product_content (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  shopify_product_id TEXT NOT NULL UNIQUE,
  description TEXT,
  specifications TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.product_content ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view product content"
ON public.product_content FOR SELECT
USING (true);

CREATE POLICY "Admins can insert product content"
ON public.product_content FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update product content"
ON public.product_content FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete product content"
ON public.product_content FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_product_content_updated_at
BEFORE UPDATE ON public.product_content
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();