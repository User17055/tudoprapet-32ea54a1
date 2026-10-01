do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'franchise_prices'
  ) then
    alter publication supabase_realtime add table public.franchise_prices;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'subscriber_prices'
  ) then
    alter publication supabase_realtime add table public.subscriber_prices;
  end if;
end $$;
