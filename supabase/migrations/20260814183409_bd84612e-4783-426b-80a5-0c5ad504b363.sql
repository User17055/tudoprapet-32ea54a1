alter table public.payments
  add column if not exists pix_expires_at timestamptz;

create index if not exists payments_pix_expiration_idx
  on public.payments (pix_expires_at)
  where method = 'pix'
    and is_active
    and status in ('pending', 'processing');