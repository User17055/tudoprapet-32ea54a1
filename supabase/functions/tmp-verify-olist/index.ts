import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { normalizeSku } from "../_shared/olist.ts";

const OLIST = "https://api.tiny.com.br/api2/";
async function olist(path: string, params: Record<string, string>) {
  const body = new URLSearchParams({ token: Deno.env.get("OLIST_API_TOKEN")!, formato: "json", ...params });
  const r = await fetch(OLIST + path, { method: "POST", body });
  return await r.json();
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  void normalizeSku;
  const shop = "tudoprapet.myshopify.com";
  const sr = await fetch(`https://${shop}/admin/api/2025-07/orders/9917940236374.json?fields=name,order_number,financial_status,total_price`, {
    headers: { "X-Shopify-Access-Token": Deno.env.get("SHOPIFY_ACCESS_TOKEN")! },
  });
  const shopify = await sr.json();
  const num = String(shopify?.order?.order_number ?? "");
  const d = new Date(); const y = new Date(d); y.setDate(d.getDate() - 1);
  const f = (x: Date) => x.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const search = await olist("pedidos.pesquisa.php", { dataInicial: f(y), dataFinal: f(d) });
  const matches = (search?.retorno?.pedidos ?? []).map((e: any) => e.pedido)
    .filter((p: any) => String(p.numero_ecommerce || "").replace(/^#/, "") === num || String(p.numero_ecommerce || "").includes("7f1def6b"))
    .map((p: any) => ({ id: p.id, numero: p.numero, numero_ecommerce: p.numero_ecommerce }));
  const order = await olist("pedido.obter.php", { id: "345413138" });
  const p = order?.retorno?.pedido ?? {};
  const nota = await olist("nota.fiscal.obter.php", { id: "345413169" });
  const n = nota?.retorno?.nota_fiscal ?? {};
  const conta = await olist("conta.receber.obter.php", { id: "345413155" });
  return new Response(JSON.stringify({
    shopify: shopify?.order ?? shopify,
    olistMatches: matches,
    order: { id: p.id, numero: p.numero, numero_ecommerce: p.numero_ecommerce, ecommerce: p.ecommerce?.nomeEcommerce, outras_despesas: p.outras_despesas, total: p.total_pedido, itens: (p.itens ?? []).map((i: any) => ({ codigo: i.item?.codigo, q: i.item?.quantidade, v: i.item?.valor_unitario })) },
    nota: { id: n.id, numero: n.numero, situacao: n.situacao, itens: (n.itens ?? []).map((i: any) => ({ codigo: i.item?.codigo, v: i.item?.valor_unitario })), outras: n.valor_outras_despesas ?? n.outras_despesas, total: n.valor_nota },
    conta: { valor: conta?.retorno?.conta?.valor, situacao: conta?.retorno?.conta?.situacao, venc: conta?.retorno?.conta?.data_vencimento },
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
