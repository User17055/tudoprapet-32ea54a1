-- Dados fiscais obrigatorios das franquias. A validacao cruzada e feita no
-- checkout para permitir que os cadastros antigos sejam completados aos poucos.
alter table public.profiles
  add column if not exists company_legal_name text,
  add column if not exists company_trade_name text,
  add column if not exists state_registration text,
  add column if not exists state_registration_indicator text;

alter table public.profiles
  drop constraint if exists profiles_state_registration_indicator_check;
alter table public.profiles
  add constraint profiles_state_registration_indicator_check
  check (
    state_registration_indicator is null
    or state_registration_indicator in ('contributor', 'exempt', 'non_contributor')
  );

alter table public.profiles
  drop constraint if exists profiles_state_registration_check;
alter table public.profiles
  add constraint profiles_state_registration_check
  check (state_registration is null or state_registration ~ '^[0-9]{2,14}$');

comment on column public.profiles.company_legal_name is 'Razao social usada na NF-e da franquia.';
comment on column public.profiles.company_trade_name is 'Nome fantasia opcional usado na NF-e/Olist.';
comment on column public.profiles.state_registration is 'Inscricao estadual, apenas digitos.';
comment on column public.profiles.state_registration_indicator is 'Situacao fiscal: contributor, exempt ou non_contributor.';