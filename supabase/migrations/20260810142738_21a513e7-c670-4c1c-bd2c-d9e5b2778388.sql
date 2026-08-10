create table if not exists public.print_jobs (
  id uuid primary key default gen_random_uuid(),
  order_id text not null,
  order_name text not null,
  zpl text not null,
  status text not null default 'queued' check (status in ('queued', 'printed', 'error')),
  source text not null default 'manual' check (source in ('manual', 'automatic')),
  error_message text,
  created_at timestamptz not null default now(),
  printed_at timestamptz
);

alter table public.print_jobs enable row level security;
create index if not exists print_jobs_queue_idx on public.print_jobs (status, created_at);

-- Sem policies: somente Edge Functions com service_role acessam a fila.
revoke all on public.print_jobs from anon, authenticated;
grant all on public.print_jobs to service_role;