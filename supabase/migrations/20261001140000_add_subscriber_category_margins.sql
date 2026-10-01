create table if not exists public.subscriber_category_margins (
  category_id uuid primary key references public.categories(id) on delete cascade,
  percent numeric(7,3) not null check (percent >= 0 and percent <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.subscriber_category_margins enable row level security;

create policy "Anyone can view subscriber category margins"
on public.subscriber_category_margins for select
using (true);

create policy "Admins can manage subscriber category margins"
on public.subscriber_category_margins for all to authenticated
using (public.has_role(auth.uid(), 'admin'))
with check (public.has_role(auth.uid(), 'admin'));

create trigger trg_subscriber_category_margins_updated_at
before update on public.subscriber_category_margins
for each row execute function public.update_updated_at_column();

comment on table public.subscriber_category_margins is
  'Percentual sobre o custo Olist usado no preco de assinante, com heranca pela arvore de categorias.';
