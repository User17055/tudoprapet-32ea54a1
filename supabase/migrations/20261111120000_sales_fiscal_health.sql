-- Toda venda tem que ter NF-e, e venda paga no site não pode ficar com conta em
-- aberto na Olist. Esta migration guarda o motivo da última falha da nota e dá
-- ao painel administrativo os dois contadores que precisam ficar em zero.

alter table public.checkout_sessions
  add column if not exists olist_invoice_error text;

comment on column public.checkout_sessions.olist_invoice_error is
  'Motivo da última rejeição/falha da NF-e na Olist (nulo quando emitida ou sem erro).';

-- Venda concluída = cliente com pedido Shopify criado e pagamento Asaas
-- confirmado, ou franquia com pedido de venda e cobrança criados na Olist.
create or replace function public.admin_sales_fiscal_health(
  p_since timestamptz default '2026-10-07T00:00:00-03:00',
  p_grace_minutes integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Acesso restrito a administradores' using errcode = '42501';
  end if;

  with sales as (
    select s.id, s.created_at, s.customer_type, s.total, s.currency,
           s.olist_order_id, s.olist_order_number,
           s.olist_invoice_status, s.olist_invoice_error,
           s.olist_payment_synced_at, s.olist_payment_sync_error,
           coalesce(s.customer_snapshot->>'name', '') as customer_name
      from public.checkout_sessions s
     where s.created_at >= p_since
       and s.created_at < now() - make_interval(mins => greatest(p_grace_minutes, 0))
       and (
         (s.customer_type = 'franchise' and s.status = 'credit_approved')
         or (
           s.customer_type in ('common', 'subscriber')
           and s.status = 'shopify_created'
           and exists (
             select 1 from public.payments p
              where p.checkout_session_id = s.id
                and p.provider = 'asaas'
                and p.status in ('confirmed', 'received')
           )
         )
       )
  ),
  issues as (
    select id, created_at, customer_type, total, currency, olist_order_number,
           customer_name, 'invoice'::text as issue,
           olist_invoice_status as invoice_status,
           coalesce(
             olist_invoice_error,
             case
               when olist_order_id is null then coalesce(olist_payment_sync_error, 'Pedido ainda não está na Olist')
               when olist_invoice_status = 'pending' then 'Aguardando autorização da SEFAZ'
               when olist_invoice_status = 'generating' then 'Emissão em andamento'
               else 'Emissão ainda não tentada'
             end
           ) as reason
      from sales
     where coalesce(olist_invoice_status, '') <> 'issued'
    union all
    select id, created_at, customer_type, total, currency, olist_order_number,
           customer_name, 'settlement'::text,
           olist_invoice_status,
           coalesce(olist_payment_sync_error, 'Baixa ainda não confirmada na Olist')
      from sales
     where customer_type in ('common', 'subscriber')
       and olist_payment_synced_at is null
  )
  select jsonb_build_object(
    'since', p_since,
    'without_invoice', (select count(*) from issues where issue = 'invoice'),
    'unsettled_paid', (select count(*) from issues where issue = 'settlement'),
    'items', coalesce((
      select jsonb_agg(to_jsonb(i) order by i.created_at)
        from (select * from issues order by created_at limit 100) i
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_sales_fiscal_health(timestamptz, integer)
  from public, anon;
grant execute on function public.admin_sales_fiscal_health(timestamptz, integer)
  to authenticated;

comment on function public.admin_sales_fiscal_health(timestamptz, integer) is
  'Painel admin: vendas concluídas sem NF-e emitida e vendas pagas no site sem baixa na Olist. O piso padrão acompanha DEFAULT_RECONCILIATION_START em olist-reconcile-franchise.';
