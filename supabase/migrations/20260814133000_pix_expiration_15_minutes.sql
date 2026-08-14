-- Prazo comercial do QR Code Pix da TudoPraPet. O Asaas pode devolver uma
-- validade muito maior; por isso preservamos a validade do provedor separada
-- e usamos pix_expires_at para encerrar a tentativa local em 15 minutos.
alter table public.payments
  add column if not exists pix_expires_at timestamptz;

create index if not exists payments_pix_expiration_idx
  on public.payments (pix_expires_at)
  where method = 'pix'
    and is_active
    and status in ('pending', 'processing');

