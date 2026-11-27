GRANT SELECT ON public.sales_orders TO authenticated;
GRANT ALL ON public.sales_orders TO service_role;
GRANT ALL ON public.olist_webhook_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.olist_webhook_events_id_seq TO service_role;
GRANT ALL ON public.olist_sync_state TO service_role;