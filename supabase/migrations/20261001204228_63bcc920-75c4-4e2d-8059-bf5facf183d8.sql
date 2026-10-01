alter table public.product_costs
  add column if not exists package_weight_kg numeric(10,3)
  check (package_weight_kg is null or package_weight_kg > 0);

comment on column public.product_costs.package_weight_kg is
  'Peso da embalagem/variacao usado na regra automatica de margem para racoes.';