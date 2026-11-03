alter table public.checkout_sessions
  drop constraint if exists checkout_sessions_olist_invoice_status_check;
alter table public.checkout_sessions
  add constraint checkout_sessions_olist_invoice_status_check
  check (olist_invoice_status is null or olist_invoice_status in ('generating','issued','pending','rejected'));

create or replace function public.claim_olist_franchise_checkout(p_session_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_updated_rows integer := 0;
begin
  update public.checkout_sessions set status = 'payment_processing'
   where id = p_session_id and customer_type = 'franchise'
     and (status = 'awaiting_payment'
       or (status = 'payment_processing' and updated_at < now() - interval '10 minutes'));
  get diagnostics v_updated_rows = row_count;
  return v_updated_rows > 0;
end; $$;

create or replace function public.claim_olist_invoice_processing(p_session_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_updated_rows integer := 0;
begin
  update public.checkout_sessions
     set olist_invoice_status = 'generating', olist_invoice_checked_at = now()
   where id = p_session_id and customer_type = 'franchise' and olist_order_id is not null
     and (olist_invoice_status is null or olist_invoice_status in ('pending','rejected')
       or (olist_invoice_status = 'generating' and olist_invoice_checked_at < now() - interval '10 minutes'));
  get diagnostics v_updated_rows = row_count;
  return v_updated_rows > 0;
end; $$;

revoke all on function public.claim_olist_invoice_processing(uuid) from public, anon, authenticated;
grant execute on function public.claim_olist_invoice_processing(uuid) to service_role;
revoke all on function public.claim_olist_franchise_checkout(uuid) from public, anon, authenticated;
grant execute on function public.claim_olist_franchise_checkout(uuid) to service_role;

drop index if exists public.checkout_sessions_olist_invoice_retry_idx;
create index checkout_sessions_olist_invoice_retry_idx
  on public.checkout_sessions (olist_invoice_checked_at)
  where customer_type = 'franchise' and olist_order_id is not null
    and (olist_invoice_status is null or olist_invoice_status in ('generating','pending','rejected'));

comment on function public.claim_olist_invoice_processing(uuid) is
  'Claims one franchise invoice for generation/emission. A stale claim may be recovered after ten minutes.';
comment on function public.claim_olist_franchise_checkout(uuid) is
  'Claims all Olist checkout side effects for one franchise session. A stale claim may be recovered after ten minutes.';