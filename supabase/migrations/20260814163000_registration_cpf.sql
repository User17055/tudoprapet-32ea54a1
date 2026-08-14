create or replace function public.is_valid_cpf(value text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  cpf text := regexp_replace(coalesce(value, ''), '\D', '', 'g');
  total integer;
  digit integer;
  index integer;
begin
  if length(cpf) <> 11 or cpf ~ '^(\d)\1{10}$' then
    return false;
  end if;

  total := 0;
  for index in 1..9 loop
    total := total + substring(cpf from index for 1)::integer * (11 - index);
  end loop;
  digit := (total * 10) % 11;
  if digit = 10 then digit := 0; end if;
  if digit <> substring(cpf from 10 for 1)::integer then return false; end if;

  total := 0;
  for index in 1..10 loop
    total := total + substring(cpf from index for 1)::integer * (12 - index);
  end loop;
  digit := (total * 10) % 11;
  if digit = 10 then digit := 0; end if;
  return digit = substring(cpf from 11 for 1)::integer;
end;
$$;

alter table public.profiles add column if not exists cpf text;

alter table public.profiles drop constraint if exists profiles_cpf_valid;
alter table public.profiles
  add constraint profiles_cpf_valid check (cpf is null or public.is_valid_cpf(cpf));

create unique index if not exists profiles_cpf_unique
  on public.profiles (cpf)
  where cpf is not null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_cpf text := regexp_replace(coalesce(new.raw_user_meta_data->>'cpf', ''), '\D', '', 'g');
begin
  if not public.is_valid_cpf(normalized_cpf) then
    raise exception 'CPF invalido';
  end if;

  insert into public.profiles (
    user_id,
    email,
    name,
    cpf,
    acquisition_source,
    referral_code
  )
  values (
    new.id,
    new.email,
    nullif(
      coalesce(
        new.raw_user_meta_data->>'name',
        new.raw_user_meta_data->>'full_name',
        trim(concat_ws(' ', new.raw_user_meta_data->>'first_name', new.raw_user_meta_data->>'last_name'))
      ),
      ''
    ),
    normalized_cpf,
    new.raw_user_meta_data->>'acquisition_source',
    nullif(new.raw_user_meta_data->>'referral_code', '')
  )
  on conflict (user_id) do update set
    name = coalesce(public.profiles.name, excluded.name),
    cpf = coalesce(public.profiles.cpf, excluded.cpf),
    acquisition_source = coalesce(public.profiles.acquisition_source, excluded.acquisition_source),
    referral_code = coalesce(public.profiles.referral_code, excluded.referral_code);
  return new;
end;
$$;
