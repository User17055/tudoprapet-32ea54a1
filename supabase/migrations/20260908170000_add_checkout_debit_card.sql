-- O debito e pago na fatura hospedada do Asaas. A API nao aceita os dados
-- do cartao de debito diretamente, mas precisamos distinguir o metodo para
-- operacao, conciliacao e mensagens do checkout.
alter table public.payments
  drop constraint if exists payments_method_check;

alter table public.payments
  add constraint payments_method_check
  check (method in ('pix', 'boleto', 'credit_card', 'debit_card', 'terms'));

alter table public.checkout_attempt_logs
  drop constraint if exists checkout_attempt_logs_payment_method_check;

alter table public.checkout_attempt_logs
  add constraint checkout_attempt_logs_payment_method_check
  check (payment_method in ('pix', 'credit_card', 'debit_card', 'terms', 'unknown'));
