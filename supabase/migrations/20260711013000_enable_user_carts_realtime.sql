DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'user_carts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_carts;
  END IF;
END;
$$;
