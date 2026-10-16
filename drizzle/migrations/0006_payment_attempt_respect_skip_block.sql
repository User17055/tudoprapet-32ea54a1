CREATE OR REPLACE FUNCTION public.create_payment_attempt(p_checkout_session_id uuid, p_provider text, p_method text, p_amount numeric, p_due_date date DEFAULT NULL::date)
 RETURNS payments LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_payment public.payments;
  v_payment_id uuid := gen_random_uuid();
  v_attempt integer;
  v_customer_type text;
  v_user_id uuid;
  v_credit public.franchise_credit_accounts;
begin
  select customer_type, user_id into v_customer_type, v_user_id
    from public.checkout_sessions where id = p_checkout_session_id for update;
  if not found then raise exception 'checkout_session_not_found'; end if;

  if v_customer_type = 'franchise' then
    if v_user_id is null then raise exception 'franchise_auth_required'; end if;
    insert into public.franchise_credit_accounts(user_id) values (v_user_id) on conflict (user_id) do nothing;
    select * into v_credit from public.franchise_credit_accounts where user_id = v_user_id for update;
    if v_credit.manually_blocked then raise exception 'franchise_manually_blocked'; end if;
    if not coalesce(v_credit.skip_payment_block, false) and exists (
      select 1 from public.payments p
        join public.checkout_sessions s on s.id = p.checkout_session_id
       where s.user_id = v_user_id
         and p.checkout_session_id <> p_checkout_session_id
         and (p.status = 'overdue'
           or (v_credit.block_on_any_open_invoice and p.status in ('pending','processing','confirmed')))
    ) then
      raise exception 'franchise_financial_block';
    end if;
  end if;

  if exists (select 1 from public.payments where checkout_session_id = p_checkout_session_id and is_active
      and status in ('pending','processing','cancellation_requested','confirmed')) then
    raise exception 'active_payment_attempt_exists';
  end if;

  select coalesce(max(attempt_number),0)+1 into v_attempt from public.payments where checkout_session_id = p_checkout_session_id;

  insert into public.payments (id, checkout_session_id, attempt_number, provider, method, amount, due_date, external_reference)
  values (v_payment_id, p_checkout_session_id, v_attempt, p_provider, p_method, p_amount, p_due_date, v_payment_id::text)
  returning * into v_payment;
  return v_payment;
end;
$function$;