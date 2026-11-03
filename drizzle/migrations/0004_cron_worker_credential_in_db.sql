CREATE TABLE IF NOT EXISTS public.cron_worker_credentials (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  token text NOT NULL DEFAULT encode(extensions.gen_random_bytes(32), 'hex'),
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.cron_worker_credentials FROM anon, authenticated;
GRANT ALL ON public.cron_worker_credentials TO service_role;
ALTER TABLE public.cron_worker_credentials ENABLE ROW LEVEL SECURITY;
INSERT INTO public.cron_worker_credentials (id) VALUES (true) ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.invoke_payment_reconciliation()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
declare v_token text;
begin
  select token into v_token from public.cron_worker_credentials where id;
  if v_token is null then
    raise warning 'Conciliacao nao executada: credencial do agendamento ausente';
    return;
  end if;
  perform net.http_post(
    url := 'https://smvtnflhkvxdmvqbxwrf.supabase.co/functions/v1/asaas-process-events',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-worker-token', v_token),
    body := jsonb_build_object('source', 'pg_cron', 'requested_at', now())
  );
end;
$$;
REVOKE ALL ON FUNCTION public.invoke_payment_reconciliation() FROM public, anon, authenticated;

DO $$ BEGIN
  IF EXISTS (select 1 from cron.job where jobname = 'asaas-process-events-every-minute') THEN
    PERFORM cron.unschedule('asaas-process-events-every-minute');
  END IF;
END $$;