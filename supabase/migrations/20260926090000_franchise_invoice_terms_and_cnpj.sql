create or replace function public.is_valid_cnpj(value text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  cnpj text := regexp_replace(coalesce(value, ''), '\D', '', 'g');
  weights_one integer[] := array[5,4,3,2,9,8,7,6,5,4,3,2];
  weights_two integer[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
  total integer := 0;
  remainder integer;
  digit integer;
  index integer;
begin
  if length(cnpj) <> 14 or cnpj ~ '^(\d)\1{13}$' then return false; end if;
  for index in 1..12 loop
    total := total + substring(cnpj from index for 1)::integer * weights_one[index];
  end loop;
  remainder := total % 11;
  digit := case when remainder < 2 then 0 else 11 - remainder end;
  if digit <> substring(cnpj from 13 for 1)::integer then return false; end if;
  total := 0;
  for index in 1..13 loop
    total := total + substring(cnpj from index for 1)::integer * weights_two[index];
  end loop;
  remainder := total % 11;
  digit := case when remainder < 2 then 0 else 11 - remainder end;
  return digit = substring(cnpj from 14 for 1)::integer;
end;
$$;

alter table public.profiles
  add column if not exists person_type text not null default 'individual',
  add column if not exists cnpj text;

alter table public.profiles drop constraint if exists profiles_person_type_check;
alter table public.profiles add constraint profiles_person_type_check
  check (person_type in ('individual', 'company'));
alter table public.profiles drop constraint if exists profiles_cnpj_valid;
alter table public.profiles add constraint profiles_cnpj_valid
  check (cnpj is null or public.is_valid_cnpj(cnpj));
create unique index if not exists profiles_cnpj_unique on public.profiles (cnpj) where cnpj is not null;

create or replace function public.is_tax_id_available(_tax_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.profiles
    where cpf = regexp_replace(coalesce(_tax_id, ''), '\D', '', 'g')
       or cnpj = regexp_replace(coalesce(_tax_id, ''), '\D', '', 'g')
  );
$$;
revoke all on function public.is_tax_id_available(text) from public;
grant execute on function public.is_tax_id_available(text) to anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_type text := coalesce(new.raw_user_meta_data->>'person_type', 'individual');
  normalized_cpf text := regexp_replace(coalesce(new.raw_user_meta_data->>'cpf', ''), '\D', '', 'g');
  normalized_cnpj text := regexp_replace(coalesce(new.raw_user_meta_data->>'cnpj', ''), '\D', '', 'g');
begin
  if requested_type = 'company' then
    if not public.is_valid_cnpj(normalized_cnpj) then raise exception 'CNPJ invalido'; end if;
    normalized_cpf := null;
  else
    requested_type := 'individual';
    if not public.is_valid_cpf(normalized_cpf) then raise exception 'CPF invalido'; end if;
    normalized_cnpj := null;
  end if;

  insert into public.profiles (
    user_id, email, name, cpf, cnpj, person_type, acquisition_source, referral_code
  ) values (
    new.id,
    new.email,
    nullif(coalesce(
      new.raw_user_meta_data->>'name',
      new.raw_user_meta_data->>'full_name',
      trim(concat_ws(' ', new.raw_user_meta_data->>'first_name', new.raw_user_meta_data->>'last_name'))
    ), ''),
    normalized_cpf,
    normalized_cnpj,
    requested_type,
    new.raw_user_meta_data->>'acquisition_source',
    nullif(new.raw_user_meta_data->>'referral_code', '')
  )
  on conflict (user_id) do update set
    name = coalesce(public.profiles.name, excluded.name),
    cpf = coalesce(public.profiles.cpf, excluded.cpf),
    cnpj = coalesce(public.profiles.cnpj, excluded.cnpj),
    person_type = excluded.person_type,
    acquisition_source = coalesce(public.profiles.acquisition_source, excluded.acquisition_source),
    referral_code = coalesce(public.profiles.referral_code, excluded.referral_code);
  return new;
end;
$$;

alter table public.checkout_sessions
  add column if not exists invoice_purpose text,
  add column if not exists franchise_payment_term_days integer;
alter table public.checkout_sessions drop constraint if exists checkout_sessions_invoice_purpose_check;
alter table public.checkout_sessions add constraint checkout_sessions_invoice_purpose_check
  check (invoice_purpose is null or invoice_purpose in ('resale', 'final_consumption'));
alter table public.checkout_sessions drop constraint if exists checkout_sessions_franchise_payment_term_days_check;
alter table public.checkout_sessions add constraint checkout_sessions_franchise_payment_term_days_check
  check (franchise_payment_term_days is null or franchise_payment_term_days in (7, 30));

update public.franchise_credit_accounts set payment_term_days = 7 where payment_term_days not in (7, 30);
alter table public.franchise_credit_accounts drop constraint if exists franchise_credit_accounts_payment_term_days_check;
alter table public.franchise_credit_accounts add constraint franchise_credit_accounts_payment_term_days_check
  check (payment_term_days in (7, 30));
alter table public.franchise_credit_accounts
  add column if not exists payment_term_updated_by uuid references auth.users(id) on delete set null,
  add column if not exists payment_term_updated_at timestamptz;

comment on column public.checkout_sessions.invoice_purpose is 'Finalidade fiscal escolhida pelo franqueado: revenda ou consumo final.';
comment on column public.checkout_sessions.franchise_payment_term_days is 'Cópia imutável do prazo comercial utilizado no pedido.';
