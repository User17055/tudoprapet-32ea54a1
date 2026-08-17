-- Controle de admissao do worker asaas-process-events.
--
-- O worker e acordado por asaas-webhook, checkout-payment e pg_cron. Nenhum
-- deles sabe dos outros, e nada impedia que duas execucoes varressem as mesmas
-- linhas ao mesmo tempo, duplicando cada consulta a API do Asaas. Foi um dos
-- fatores do bloqueio por limite de requisicoes em 17/08/2026.
--
-- A responsabilidade fica com o worker, nao com quem chama: o proximo gatilho
-- que alguem adicionar entra pela mesma porta e nao precisa saber de nada.
--
-- Lease com expiracao, e nao advisory lock, porque cada chamada PostgREST e uma
-- transacao propria: `pg_try_advisory_xact_lock` soltaria na volta do RPC, e um
-- lock de sessao ficaria preso se o worker morresse no meio. O lease sobrevive a
-- chamada e expira sozinho.

-- Os dois defaults sao '-infinity' para que a primeira reivindicacao de um
-- worker novo passe: com default now(), a linha nasceria travada ate o relogio
-- andar, e dentro da mesma transacao now() nao anda.
create table if not exists public.worker_leases (
  name          text        primary key,
  locked_until  timestamptz not null default '-infinity'::timestamptz,
  last_run_at   timestamptz not null default '-infinity'::timestamptz,
  run_id        uuid
);

-- Sem policy nenhuma: a service role ignora RLS e e a unica que precisa entrar
-- aqui. Habilitar sem policy fecha a tabela para anon e authenticated.
alter table public.worker_leases enable row level security;

comment on table public.worker_leases is
  'Exclusao mutua e intervalo minimo entre execucoes de workers. Uma linha por worker.';

-- Devolve o run_id quando a execucao esta autorizada, ou NULL quando outra ja
-- esta rodando (locked_until no futuro) ou quando a ultima terminou ha menos de
-- p_cooldown_seconds. Quem recebe NULL encerra sem trabalho -- o custo de uma
-- execucao recusada e um UPDATE que nao casa.
create or replace function public.claim_worker_lease(
  p_name             text,
  p_lease_seconds    integer default 120,
  p_cooldown_seconds integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id uuid := gen_random_uuid();
begin
  insert into public.worker_leases (name)
  values (p_name)
  on conflict (name) do nothing;

  -- clock_timestamp() e nao now(): now() e o instante em que a transacao comecou
  -- e fica congelado ate o fim dela. Um lease mede tempo de parede, e assim a
  -- funcao se comporta igual sendo chamada uma vez por transacao (producao, via
  -- PostgREST) ou varias dentro da mesma (teste).
  update public.worker_leases
     set locked_until = clock_timestamp() + make_interval(secs => greatest(1, p_lease_seconds)),
         last_run_at  = clock_timestamp(),
         run_id       = v_run_id
   where name = p_name
     and locked_until < clock_timestamp()
     and last_run_at < clock_timestamp() - make_interval(secs => greatest(0, p_cooldown_seconds));

  if not found then
    return null;
  end if;

  return v_run_id;
end;
$$;

-- Libera antes da hora para o proximo gatilho nao esperar o lease inteiro. Nao
-- mexe em last_run_at de proposito: o intervalo minimo conta do inicio da ultima
-- execucao, senao uma rodada rapida derrubaria o cooldown junto.
create or replace function public.release_worker_lease(
  p_name   text,
  p_run_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.worker_leases
     set locked_until = clock_timestamp()
   where name = p_name
     and run_id = p_run_id;

  return found;
end;
$$;

revoke all on function public.claim_worker_lease(text, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_worker_lease(text, integer, integer) to service_role;

revoke all on function public.release_worker_lease(text, uuid) from public, anon, authenticated;
grant execute on function public.release_worker_lease(text, uuid) to service_role;
