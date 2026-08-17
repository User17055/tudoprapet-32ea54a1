-- O webhook do Asaas é o caminho principal para atualizações financeiras.
-- A conciliação é apenas uma rede de segurança e não deve fazer polling contínuo.
do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
    from cron.job
   where jobname = 'reconcile-paid-shopify-orders';

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'reconcile-paid-shopify-orders',
    '*/10 * * * *',
    'select public.invoke_payment_reconciliation();'
  );
end;
$$;

-- Neutraliza imediatamente o acionamento do worker feito pela versão antiga de
-- checkout-status para Pix que já estavam aguardando pagamento no deploy.
-- O webhook continua podendo confirmar normalmente essas sessões.
update public.checkout_sessions as session
   set status = 'awaiting_payment'
 where session.status = 'payment_processing'
   and exists (
     select 1
       from public.payments as payment
      where payment.checkout_session_id = session.id
        and payment.method = 'pix'
        and payment.is_active = true
        and payment.status in ('pending', 'processing')
   );
