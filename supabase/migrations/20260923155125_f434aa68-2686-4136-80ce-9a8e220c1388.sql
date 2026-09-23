create or replace function public.is_cpf_available(_cpf text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.profiles
    where cpf = regexp_replace(coalesce(_cpf, ''), '\D', '', 'g')
  );
$$;

revoke all on function public.is_cpf_available(text) from public;
grant execute on function public.is_cpf_available(text) to anon, authenticated;