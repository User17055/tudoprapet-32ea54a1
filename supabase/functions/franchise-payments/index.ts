import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { corsHeaders, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { optionalCheckoutUser } from "../_shared/checkout-access.ts";
import { getOlistInvoice } from "../_shared/olist.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Método não permitido", 405);

  try {
    const auth = await optionalCheckoutUser(req);
    if (auth.invalidAuthorization || !auth.user) return errorResponse("Não autorizado", 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: profile, error: profileError } = await admin.from("profiles")
      .select("is_franchisee")
      .eq("user_id", auth.user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile?.is_franchisee) return errorResponse("Acesso exclusivo para franquias", 403);

    const { data: sessions, error: sessionsError } = await admin.from("checkout_sessions")
      .select(
        "id,created_at,status,currency,total,invoice_purpose,franchise_payment_term_days,olist_order_id,olist_order_number,olist_invoice_id,olist_invoice_number,olist_invoice_url",
      )
      .eq("user_id", auth.user.id)
      .eq("customer_type", "franchise")
      .order("created_at", { ascending: false })
      .limit(100);
    if (sessionsError) throw sessionsError;

    // Pedidos antigos ainda não tinham o link salvo. Recupera o endereço da NF-e
    // na Olist e persiste para que os próximos acessos não dependam de outra consulta.
    const olistToken = Deno.env.get("OLIST_API_TOKEN") || Deno.env.get("TINY_API_TOKEN") || "";
    const missingInvoiceLinks = (sessions || [])
      .filter((session) => session.olist_invoice_id && !session.olist_invoice_url)
      .slice(0, 10);
    if (olistToken && missingInvoiceLinks.length) {
      await Promise.all(missingInvoiceLinks.map(async (session) => {
        try {
          const invoice = await getOlistInvoice(String(session.olist_invoice_id), olistToken);
          session.olist_invoice_number = invoice.number || session.olist_invoice_number;
          session.olist_invoice_url = invoice.accessUrl || null;
          if (invoice.number || invoice.accessUrl) {
            const { error: invoiceUpdateError } = await admin.from("checkout_sessions").update({
              olist_invoice_number: session.olist_invoice_number,
              olist_invoice_url: session.olist_invoice_url,
            }).eq("id", session.id);
            if (invoiceUpdateError) {
              console.error("franchise-payments invoice save:", invoiceUpdateError);
            }
          }
        } catch (invoiceError) {
          console.error(`franchise-payments invoice ${session.olist_invoice_id}:`, invoiceError);
        }
      }));
    }

    const sessionIds = (sessions || []).map((session) => session.id);
    if (!sessionIds.length) return jsonResponse({ payments: [] });

    const { data: paymentRows, error: paymentsError } = await admin.from("payments")
      .select(
        "id,checkout_session_id,amount,status,due_date,provider_payment_id,provider_payment_url,created_at",
      )
      .in("checkout_session_id", sessionIds)
      .eq("provider", "olist")
      .order("created_at", { ascending: false });
    if (paymentsError) throw paymentsError;

    const latestBySession = new Map<string, Record<string, unknown>>();
    for (const payment of paymentRows || []) {
      if (!latestBySession.has(payment.checkout_session_id)) {
        latestBySession.set(payment.checkout_session_id, payment);
      }
    }

    const payments = (sessions || []).flatMap((session) => {
      const payment = latestBySession.get(session.id);
      if (!payment && !session.olist_order_id) return [];
      return [{
        id: String(payment?.id || session.id),
        checkoutSessionId: session.id,
        orderNumber: session.olist_order_number || session.olist_order_id || null,
        invoiceNumber: session.olist_invoice_number || null,
        invoiceUrl: session.olist_invoice_url || null,
        invoicePurpose: session.invoice_purpose || null,
        paymentTermDays: session.franchise_payment_term_days || null,
        amount: Number(payment?.amount ?? session.total),
        currency: session.currency || "BRL",
        status: String(
          payment?.status || (session.status === "cancelled" ? "cancelled" : "processing"),
        ),
        dueDate: payment?.due_date || null,
        paymentUrl: payment?.provider_payment_url || null,
        providerPaymentId: payment?.provider_payment_id || null,
        createdAt: String(payment?.created_at || session.created_at),
      }];
    });

    return jsonResponse({ payments });
  } catch (error) {
    console.error("franchise-payments:", error);
    return errorResponse("Não foi possível carregar os pagamentos da franquia", 500);
  }
});
