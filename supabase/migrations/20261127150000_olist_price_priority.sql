-- The staging rows belong to a single read. Readers only see a completed publication.
create table public.olist_product_snapshot_stage (like public.olist_product_snapshot including defaults);
alter table public.olist_product_snapshot_stage add primary key (run_id,olist_product_id);
alter table public.olist_product_snapshot_stage enable row level security;
revoke all on public.olist_product_snapshot_stage from public, anon, authenticated;
grant all on public.olist_product_snapshot_stage to service_role;
create table public.olist_price_lists_stage (like public.olist_price_lists including defaults);
alter table public.olist_price_lists_stage add primary key (run_id,olist_price_list_id);
alter table public.olist_price_lists_stage enable row level security;
revoke all on public.olist_price_lists_stage from public, anon, authenticated;
grant all on public.olist_price_lists_stage to service_role;
create table public.olist_price_list_exceptions_stage (like public.olist_price_list_exceptions including defaults);
alter table public.olist_price_list_exceptions_stage add primary key (run_id,olist_price_list_id,olist_product_id);
alter table public.olist_price_list_exceptions_stage enable row level security;
revoke all on public.olist_price_list_exceptions_stage from public, anon, authenticated;
grant all on public.olist_price_list_exceptions_stage to service_role;

create function public.publish_olist_catalog(p_run uuid) returns void
language plpgsql set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtext('publish_olist_catalog'));
  if not exists (select 1 from olist_catalog_runs where id=p_run and kind='catalog' and status='running')
     or exists (select 1 from olist_catalog_runs where kind='catalog' and status='done'
       and started_at > (select started_at from olist_catalog_runs where id=p_run)) then
    raise exception 'Esta leitura foi substituída. Leia o catálogo novamente.';
  end if;
  delete from olist_price_list_exceptions;
  delete from olist_price_lists;
  delete from olist_product_snapshot;
  insert into olist_product_snapshot select * from olist_product_snapshot_stage where run_id=p_run;
  delete from olist_product_snapshot_stage where run_id=p_run;
  insert into olist_price_lists select * from olist_price_lists_stage where run_id=p_run;
  delete from olist_price_lists_stage where run_id=p_run;
  insert into olist_price_list_exceptions select * from olist_price_list_exceptions_stage where run_id=p_run;
  delete from olist_price_list_exceptions_stage where run_id=p_run;

  update olist_catalog_runs set status='done', finished_at=now() where id=p_run;
end;
$$;
revoke all on function public.publish_olist_catalog(uuid) from public,anon,authenticated;
grant execute on function public.publish_olist_catalog(uuid) to service_role;

alter table public.franchise_prices add column price_origin text not null default 'rule';
alter table public.subscriber_prices add column price_origin text not null default 'rule';
drop trigger if exists franchise_price_cost_floor on public.franchise_prices;

-- Background cost refreshes must preserve an approved manual or list price.
create function public.keep_explicit_price() returns trigger language plpgsql as $$
begin
  if old.price_origin <> 'rule' and new.price_origin='rule'
     and current_setting('app.explicit_price_apply', true) is distinct from 'yes' then
    return null;
  end if;
  return new;
end;
$$;
create trigger keep_explicit_price before update on public.franchise_prices
for each row execute function public.keep_explicit_price();
create trigger keep_explicit_price before update on public.subscriber_prices
for each row execute function public.keep_explicit_price();

-- One transaction per variant including the cost history and all local prices.
create function public.save_variant_values(p_product text,p_variant text,p_sku text,p_values jsonb,
  p_origin text,p_checked timestamptz default null,p_weight numeric default null,p_catalog uuid default null,
  p_before jsonb default null) returns void language plpgsql set search_path=public as $$
declare
  previous numeric;
  amount numeric;
  key text;
  origin text;
  current_values jsonb;
begin
  if p_origin not in ('manual','olist') or p_origin is null then raise exception 'Origem inválida'; end if;
  perform pg_advisory_xact_lock(hashtext(p_variant));
  if p_catalog is not null then
    perform pg_advisory_xact_lock_shared(hashtext('publish_olist_catalog'));
    if p_catalog is distinct from (select id from olist_catalog_runs where kind='catalog' and status='done' order by started_at desc limit 1)
      then raise exception 'Catálogo alterado. Simule novamente.'; end if;
  end if;
  select cost into previous from product_costs where shopify_variant_id=p_variant for update;
  if p_before is not null then
    current_values := jsonb_build_object('cost',previous,
      'customer',(select price from customer_prices where shopify_variant_id=p_variant),
      'franchise',(select price from franchise_prices where shopify_variant_id=p_variant),
      'subscriber',(select subscriber_price from subscriber_prices where shopify_variant_id=p_variant));
    if current_values <> p_before then raise exception 'Preços alterados. Simule novamente.'; end if;
  end if;
  perform set_config('app.explicit_price_apply','yes',true);
  foreach key in array array['cost','subscriber','franchise','customer'] loop
    if not p_values ? key then continue; end if;
    amount := (p_values->>key)::numeric;
    if amount is null and key in ('customer','franchise','subscriber') and p_origin='manual' then
      if key='customer' then delete from customer_prices where shopify_variant_id=p_variant;
      elsif key='subscriber' then delete from subscriber_prices where shopify_variant_id=p_variant;
      else delete from franchise_prices where shopify_variant_id=p_variant; end if;
      continue;
    end if;
    if amount is null or amount<=0 then raise exception 'Preço inválido'; end if;
    origin:=coalesce(p_values->>(key || 'Origin'),p_origin);
    if key='cost' then
      insert into product_costs(shopify_product_id,shopify_variant_id,sku,cost,source,synced_at,package_weight_kg)
        values (p_product,p_variant,p_sku,amount,p_origin,coalesce(p_checked,now()),p_weight)
        on conflict (shopify_variant_id) do update set cost=excluded.cost,source=excluded.source,sku=excluded.sku,
          synced_at=excluded.synced_at,package_weight_kg=coalesce(excluded.package_weight_kg,product_costs.package_weight_kg),
          previous_cost=case when product_costs.cost<>excluded.cost then product_costs.cost else product_costs.previous_cost end,
          cost_changed_at=case when product_costs.cost<>excluded.cost then now() else product_costs.cost_changed_at end;
      if previous is distinct from amount then
        insert into product_cost_history(shopify_variant_id,old_cost,new_cost,source) values(p_variant,previous,amount,p_origin);
      end if;
    elsif key='subscriber' then
      insert into subscriber_prices(shopify_product_id,shopify_variant_id,subscriber_price,price_origin)
      values(p_product,p_variant,amount,origin) on conflict(shopify_variant_id) do update
      set subscriber_price=excluded.subscriber_price,price_origin=excluded.price_origin;
    elsif key='franchise' then
      insert into franchise_prices(shopify_product_id,shopify_variant_id,price,price_origin)
      values(p_product,p_variant,amount,origin) on conflict(shopify_variant_id) do update
      set price=excluded.price,price_origin=excluded.price_origin;
    else
      insert into customer_prices(shopify_product_id,shopify_variant_id,price)
      values(p_product,p_variant,amount) on conflict(shopify_variant_id) do update set price=excluded.price;
    end if;
  end loop;
end;
$$;
revoke all on function public.save_variant_values(text,text,text,jsonb,text,timestamptz,numeric,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_variant_values(text,text,text,jsonb,text,timestamptz,numeric,uuid,jsonb) to service_role;
