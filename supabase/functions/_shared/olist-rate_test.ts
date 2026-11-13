import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { getOlistInvoice, issueFranchiseInvoiceSafely, olistCallsPerMinute } from "./olist.ts";

// O limitador compartilhado fala com o banco via SUPABASE_URL. Cada teste
// troca o fetch e decide o que o "banco" responde.
function withEnv(vars: Record<string, string | undefined>, run: () => Promise<void>) {
  const previous = Object.fromEntries(Object.keys(vars).map((key) => [key, Deno.env.get(key)]));
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) Deno.env.delete(key);
    else Deno.env.set(key, value);
  }
  return run().finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  });
}

const invoiceOk = { retorno: { status: "OK", nota_fiscal: { id: 1, numero: "9", chave_acesso: "1".repeat(44) } } };

Deno.test("limite padrão é 30 chamadas por minuto e pode ser configurado", () =>
  withEnv({ OLIST_API_CALLS_PER_MINUTE: undefined }, () => {
    assertEquals(olistCallsPerMinute(), 30);
    Deno.env.set("OLIST_API_CALLS_PER_MINUTE", "120");
    assertEquals(olistCallsPerMinute(), 120);
    return Promise.resolve();
  }));

Deno.test("sem banco configurado a chamada segue sem consultar o limitador", () =>
  withEnv({ SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined }, async () => {
    const original = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = ((url: string | URL | Request) => {
      urls.push(String(url));
      return Promise.resolve(new Response(JSON.stringify(invoiceOk)));
    }) as typeof fetch;
    try {
      await getOlistInvoice("1", "t");
      assertEquals(urls.some((url) => url.includes("claim_olist_api_call")), false);
    } finally {
      globalThis.fetch = original;
    }
  }));

Deno.test("limitador fora do ar não trava a chamada à Olist", () =>
  withEnv({ SUPABASE_URL: "https://db.example", SUPABASE_SERVICE_ROLE_KEY: "k" }, async () => {
    const original = globalThis.fetch;
    globalThis.fetch = ((url: string | URL | Request) =>
      Promise.resolve(
        String(url).includes("/rpc/")
          ? new Response("not found", { status: 404 })
          : new Response(JSON.stringify(invoiceOk)),
      )) as typeof fetch;
    try {
      const invoice = await getOlistInvoice("1", "t");
      assertEquals(invoice.issued, true);
    } finally {
      globalThis.fetch = original;
    }
  }));

Deno.test("limite cheio: nota fica pendente (não recusada) e a Olist não é chamada", () =>
  withEnv({ SUPABASE_URL: "https://db.example", SUPABASE_SERVICE_ROLE_KEY: "k" }, async () => {
    const original = globalThis.fetch;
    const olistCalls: string[] = [];
    globalThis.fetch = ((url: string | URL | Request) => {
      if (String(url).includes("claim_olist_api_call")) {
        return Promise.resolve(new Response("45000")); // esperar 45 s > limite de espera
      }
      olistCalls.push(String(url));
      return Promise.resolve(new Response(JSON.stringify(invoiceOk)));
    }) as typeof fetch;
    try {
      const outcome = await issueFranchiseInvoiceSafely({
        orderId: "501",
        token: "t",
        savedInvoice: { id: "900", number: "1", issued: false },
      });
      assertEquals(outcome.status, "pending");
      assertEquals(outcome.error?.includes("Limite de chamadas"), true);
      assertEquals(olistCalls.length, 0);
    } finally {
      globalThis.fetch = original;
    }
  }));
