-- Dados reutilizáveis do checkout. Informações financeiras nunca ficam
-- acessíveis diretamente ao navegador; somente Edge Functions com service_role.

create table if not exists public.checkout_customer_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  invoice_email text not null,
  cpf_cnpj text not null,
  mobile_phone text not null,
  billing_same_as_shipping boolean not null default true,
  asaas_customer_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null default 'Casa',
  recipient_name text not null,
  address1 text not null,
  number text not null,
  address2 text,
  neighborhood text not null,
  city text not null,
  province_code text not null check (province_code ~ '^[A-Z]{2}$'),
  postal_code text not null check (postal_code ~ '^\d{8}$'),
  country_code text not null default 'BR' check (country_code = 'BR'),
  is_default_shipping boolean not null default false,
  is_default_billing boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists customer_one_default_shipping
  on public.customer_addresses (user_id) where is_default_shipping;
create unique index if not exists customer_one_default_billing
  on public.customer_addresses (user_id) where is_default_billing;
create index if not exists customer_addresses_user_idx
  on public.customer_addresses (user_id, updated_at desc);

create table if not exists public.customer_payment_methods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'asaas',
  provider_customer_id text not null,
  token_ciphertext text not null,
  token_iv text not null,
  brand text,
  last_four text not null check (last_four ~ '^\d{4}$'),
  holder_name text,
  is_default boolean not null default false,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists customer_one_default_payment_method
  on public.customer_payment_methods (user_id) where is_default and revoked_at is null;
create index if not exists customer_payment_methods_user_idx
  on public.customer_payment_methods (user_id, updated_at desc) where revoked_at is null;

alter table public.checkout_sessions
  add column if not exists billing_address_snapshot jsonb not null default '{}'::jsonb;

alter table public.checkout_sessions drop constraint if exists checkout_sessions_shipping_code_check;
alter table public.checkout_sessions add constraint checkout_sessions_shipping_code_check
  check (shipping_code is null or shipping_code in ('pick_up', 'pac', 'sedex', 'local_delivery', 'shipping'));

alter table public.checkout_customer_profiles enable row level security;
alter table public.customer_addresses enable row level security;
alter table public.customer_payment_methods enable row level security;

revoke all on public.checkout_customer_profiles from anon, authenticated;
revoke all on public.customer_addresses from anon, authenticated;
revoke all on public.customer_payment_methods from anon, authenticated;
grant all on public.checkout_customer_profiles to service_role;
grant all on public.customer_addresses to service_role;
grant all on public.customer_payment_methods to service_role;

drop trigger if exists checkout_customer_profiles_updated_at on public.checkout_customer_profiles;
create trigger checkout_customer_profiles_updated_at before update on public.checkout_customer_profiles
  for each row execute function public.update_updated_at_column();
drop trigger if exists customer_addresses_updated_at on public.customer_addresses;
create trigger customer_addresses_updated_at before update on public.customer_addresses
  for each row execute function public.update_updated_at_column();
drop trigger if exists customer_payment_methods_updated_at on public.customer_payment_methods;
create trigger customer_payment_methods_updated_at before update on public.customer_payment_methods
  for each row execute function public.update_updated_at_column();

-- Define padrão sem violar o índice parcial em atualizações concorrentes.
create or replace function public.save_customer_address(
  p_user_id uuid,
  p_address jsonb,
  p_address_id uuid default null,
  p_default_shipping boolean default true,
  p_default_billing boolean default false
)
returns public.customer_addresses
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.customer_addresses;
  v_id uuid := coalesce(p_address_id, gen_random_uuid());
begin
  if p_default_shipping then
    update public.customer_addresses set is_default_shipping = false where user_id = p_user_id;
  end if;
  if p_default_billing then
    update public.customer_addresses set is_default_billing = false where user_id = p_user_id;
  end if;

  insert into public.customer_addresses (
    id, user_id, label, recipient_name, address1, number, address2,
    neighborhood, city, province_code, postal_code, country_code,
    is_default_shipping, is_default_billing
  ) values (
    v_id, p_user_id, coalesce(nullif(p_address->>'label', ''), 'Casa'),
    p_address->>'recipientName', p_address->>'address1', p_address->>'number',
    nullif(p_address->>'address2', ''), p_address->>'neighborhood', p_address->>'city',
    upper(p_address->>'provinceCode'), regexp_replace(p_address->>'postalCode', '\D', '', 'g'),
    'BR', p_default_shipping, p_default_billing
  )
  on conflict (id) do update set
    label = excluded.label, recipient_name = excluded.recipient_name,
    address1 = excluded.address1, number = excluded.number, address2 = excluded.address2,
    neighborhood = excluded.neighborhood, city = excluded.city,
    province_code = excluded.province_code, postal_code = excluded.postal_code,
    is_default_shipping = excluded.is_default_shipping,
    is_default_billing = excluded.is_default_billing
  where public.customer_addresses.user_id = p_user_id
  returning * into v_row;

  if v_row.id is null then raise exception 'address_not_owned'; end if;
  return v_row;
end;
$$;

revoke all on function public.save_customer_address(uuid, jsonb, uuid, boolean, boolean) from public, anon, authenticated;
grant execute on function public.save_customer_address(uuid, jsonb, uuid, boolean, boolean) to service_role;
