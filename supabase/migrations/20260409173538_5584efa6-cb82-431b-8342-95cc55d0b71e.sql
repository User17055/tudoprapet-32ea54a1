
CREATE TABLE public.club_members (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.club_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view club members"
ON public.club_members
FOR SELECT
TO public
USING (true);
