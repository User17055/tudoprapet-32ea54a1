CREATE OR REPLACE FUNCTION public.claim_olist_invoice_processing(p_session_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_updated_rows integer := 0;
begin
  update public.checkout_sessions
     set olist_invoice_status = 'generating', olist_invoice_checked_at = now()
   where id = p_session_id
     and customer_type in ('franchise', 'common', 'subscriber')
     and olist_order_id is not null
     and (olist_invoice_status is null or olist_invoice_status in ('pending','rejected')
       or (olist_invoice_status = 'generating' and olist_invoice_checked_at < now() - interval '10 minutes'));
  get diagnostics v_updated_rows = row_count;
  return v_updated_rows > 0;
end; $function$;

REVOKE ALL ON FUNCTION public.claim_olist_invoice_processing(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_olist_invoice_processing(uuid) TO service_role;