// Temporária: diagnóstico somente leitura da conta a receber de um pedido com NF-e. Apagar após uso.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { findImportedOlistOrders, getOlistOrderInvoiceId } from "../_shared/olist.ts";
import { getShopifyOrderReference, shopifyAdminToken } from "../_shared/shopify.ts";

async function raw(url: string, token: string, body: Record<string, string>) {
  const form = new URLSearchParams({ token, formato: "json", ...body });
  const r = await fetch(url, { method: "POST", body: form });
  return await r.json().catch(() => null);
}

Deno.serve(async (req) => {
  const sid = new URL(req.url).searchParams.get("sid")!;
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const token = Deno.env.get("OLIST_API_TOKEN")!;
  const { data: s } = await admin.from("checkout_sessions").select("id,shopify_order_id,total")
    .eq("id", sid).single();
  const ref = await getShopifyOrderReference(String(s!.shopify_order_id), shopifyAdminToken()!);
  const orders = await findImportedOlistOrders([ref.id, ref.name, ref.orderNumber], token);
  const order = orders[0];
  const invoiceId = order ? await getOlistOrderInvoiceId(order.id, token) : null;
  const byOrder = order ? await raw("https://api.tiny.com.br/api2/contas.receber.pesquisa.php", token, { id_origem: order.id }) : null;
  const byInvoice = invoiceId ? await raw("https://api.tiny.com.br/api2/contas.receber.pesquisa.php", token, { id_origem: invoiceId }) : null;
  const invoice = invoiceId ? await raw("https://api.tiny.com.br/api2/nota.fiscal.obter.php", token, { id: invoiceId }) : null;
  const nf = invoice?.retorno?.nota_fiscal;
  return new Response(JSON.stringify({
    total: s!.total, order, invoiceId, byOrder: byOrder?.retorno, byInvoice: byInvoice?.retorno,
    nota: nf ? { numero: nf.numero, situacao: nf.situacao, valor: nf.valor_nota, parcelas: nf.parcelas, forma: nf.forma_pagamento } : invoice?.retorno,
  }), { headers: { "Content-Type": "application/json" } });
});
