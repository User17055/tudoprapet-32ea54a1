// Testa o isolamento do orcamento de chamadas ao Asaas.
//
// O que estes testes protegem: um isolate do Deno atende varias requisicoes e
// pode atender duas ao mesmo tempo. Enquanto o contador era estado de modulo, a
// segunda requisicao zerava o contador da primeira no meio da varredura dela --
// as duas juntas gastavam muito mais que o teto, que e exatamente o que o
// mecanismo existe para impedir.
//
// Rodar:  deno test --allow-env supabase/functions/_shared/asaas_test.ts

import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  AsaasBudgetExhausted,
  asaasCallsUsed,
  createAsaasBudget,
  getAsaasPayment,
  isAsaasBudgetExhausted,
} from "./asaas.ts";

Deno.env.set("ASAAS_API_KEY", "chave-de-teste");
Deno.env.set("ASAAS_API_URL", "https://asaas.invalido/v3");

const fetchReal = globalThis.fetch;

/**
 * Troca o fetch por um que nao sai para a rede, conta as chamadas e responde uma
 * cobranca qualquer. `delayMs` serve para forcar as duas requisicoes do teste de
 * concorrencia a se intercalarem de verdade, em vez de uma terminar antes da
 * outra comecar.
 */
function stubFetch(delayMs = 0) {
  let calls = 0;
  globalThis.fetch = ((_input: string | URL | Request, _init?: RequestInit) => {
    calls++;
    const body = JSON.stringify({ id: "pay_x", status: "PENDING" });
    const response = new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    return delayMs > 0
      ? new Promise<Response>((resolve) => setTimeout(() => resolve(response), delayMs))
      : Promise.resolve(response);
  }) as typeof fetch;
  return {
    get calls() {
      return calls;
    },
    restore() {
      globalThis.fetch = fetchReal;
    },
  };
}

Deno.test("orcamento para na cota e nao chama a API depois disso", async () => {
  const rede = stubFetch();
  try {
    const budget = createAsaasBudget(3);

    for (let i = 0; i < 3; i++) await getAsaasPayment(`pay_${i}`, budget);

    assertEquals(asaasCallsUsed(budget), 3);
    assert(isAsaasBudgetExhausted(budget));

    await assertRejects(
      () => getAsaasPayment("pay_estourado", budget),
      AsaasBudgetExhausted,
    );

    // A quarta chamada nao pode ter saido para a rede: parar depois de gastar
    // nao serve para nada.
    assertEquals(rede.calls, 3, "a chamada recusada nao pode chegar ao fetch");
  } finally {
    rede.restore();
  }
});

Deno.test("sem orcamento nao ha teto (caminho do checkout)", async () => {
  const rede = stubFetch();
  try {
    for (let i = 0; i < 5; i++) await getAsaasPayment(`pay_${i}`);
    assertEquals(rede.calls, 5);
  } finally {
    rede.restore();
  }
});

Deno.test("duas requisicoes concorrentes no mesmo isolate nao compartilham orcamento", async () => {
  // 5ms por chamada garante intercalacao: enquanto A espera a resposta, B roda.
  const rede = stubFetch(5);
  try {
    const orcamentoA = createAsaasBudget(4);
    const orcamentoB = createAsaasBudget(4);

    // Cada "requisicao" tenta gastar mais do que tem, para que o teste tambem
    // cubra o comportamento no limite e nao so a contagem.
    const requisicao = async (prefixo: string, budget: ReturnType<typeof createAsaasBudget>) => {
      let ok = 0;
      let recusadas = 0;
      for (let i = 0; i < 6; i++) {
        try {
          await getAsaasPayment(`${prefixo}_${i}`, budget);
          ok++;
        } catch (error) {
          if (!(error instanceof AsaasBudgetExhausted)) throw error;
          recusadas++;
        }
      }
      return { ok, recusadas };
    };

    const [a, b] = await Promise.all([
      requisicao("a", orcamentoA),
      requisicao("b", orcamentoB),
    ]);

    // Se o contador fosse global, uma zeraria a outra: cada lado passaria de 4
    // chamadas e o total passaria de 8.
    assertEquals(a.ok, 4, "A deveria gastar exatamente o proprio orcamento");
    assertEquals(b.ok, 4, "B deveria gastar exatamente o proprio orcamento");
    assertEquals(a.recusadas, 2);
    assertEquals(b.recusadas, 2);
    assertEquals(asaasCallsUsed(orcamentoA), 4);
    assertEquals(asaasCallsUsed(orcamentoB), 4);
    assertEquals(rede.calls, 8, "total de chamadas a rede deve ser a soma dos dois tetos");
  } finally {
    rede.restore();
  }
});

Deno.test("orcamento esgotado de um lado nao bloqueia o outro", async () => {
  const rede = stubFetch(5);
  try {
    // A ja chega sem cota; B tem cota inteira. B nao pode ser afetado.
    const orcamentoA = createAsaasBudget(1);
    const orcamentoB = createAsaasBudget(3);

    await getAsaasPayment("a_0", orcamentoA);
    assert(isAsaasBudgetExhausted(orcamentoA));

    const resultados = await Promise.allSettled([
      getAsaasPayment("a_1", orcamentoA),
      getAsaasPayment("b_0", orcamentoB),
      getAsaasPayment("b_1", orcamentoB),
    ]);

    assertEquals(resultados[0].status, "rejected");
    assertEquals(resultados[1].status, "fulfilled");
    assertEquals(resultados[2].status, "fulfilled");
    assertEquals(asaasCallsUsed(orcamentoB), 2);
    assert(!isAsaasBudgetExhausted(orcamentoB), "B ainda tem cota sobrando");
  } finally {
    rede.restore();
  }
});

Deno.test("requisicao que falha na rede consome cota", async () => {
  // O Asaas conta a requisicao mesmo quando devolve erro; nao contar aqui
  // esconderia o consumo real justo quando algo esta errado.
  globalThis.fetch = (() => Promise.resolve(new Response("indisponivel", { status: 503 }))) as typeof fetch;
  try {
    const budget = createAsaasBudget(2);
    await assertRejects(() => getAsaasPayment("pay_0", budget));
    assertEquals(asaasCallsUsed(budget), 1);
  } finally {
    globalThis.fetch = fetchReal;
  }
});
