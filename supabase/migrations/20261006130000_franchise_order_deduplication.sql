create table if not exists public.franchise_order_submission_locks (
  user_id uuid not null references auth.users(id) on delete cascade,
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  locked_until timestamptz not null,
  checkout_session_id uuid references public.checkout_sessions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, fingerprint)
);

alter table public.franchise_order_submission_locks enable row level security;
revoke all on public.franchise_order_submission_locks from public, anon, authenticated;
grant all on public.franchise_order_submission_locks to service_role;

create or replace function public.claim_franchise_order_submission(
  p_user_id uuid,
  p_fingerprint text,
  p_window_seconds integer default 3600
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  claimed boolean := false;
begin
  if p_user_id is null or p_fingerprint !~ '^[0-9a-f]{64}$' or p_window_seconds < 60 then
    raise exception 'invalid_franchise_order_submission';
  end if;

  insert into public.franchise_order_submission_locks (
    user_id, fingerprint, locked_until, checkout_session_id, updated_at
  ) values (
    p_user_id, p_fingerprint, now() + make_interval(secs => p_window_seconds), null, now()
  )
  on conflict (user_id, fingerprint) do update
    set locked_until = excluded.locked_until,
        checkout_session_id = null,
        updated_at = now()
    where public.franchise_order_submission_locks.locked_until <= now()
  returning true into claimed;

  return coalesce(claimed, false);
end;
$$;

create or replace function public.release_franchise_order_submission(
  p_user_id uuid,
  p_fingerprint text
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.franchise_order_submission_locks
  where user_id = p_user_id
    and fingerprint = p_fingerprint
    and checkout_session_id is null;
$$;

revoke all on function public.claim_franchise_order_submission(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.release_franchise_order_submission(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_franchise_order_submission(uuid, text, integer) to service_role;
grant execute on function public.release_franchise_order_submission(uuid, text) to service_role;

create index if not exists franchise_order_submission_locks_expiry_idx
  on public.franchise_order_submission_locks (locked_until);
