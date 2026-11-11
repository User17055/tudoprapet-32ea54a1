import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { requireUser } from "../_shared/auth.ts";
import { corsHeaders, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { getOlistInvoice } from "../_shared/olist.ts";

/**
 * Todas as vendas do usuário logado em um só lugar: pedidos do site
 * (checkout_sessions) e pedidos de venda lançados direto na Olist
 * (sales_orders). Cada venda traz o pedido de venda, a NF-e e o pagamento.
 */

type InvoiceStatus = "issued" | "pending" | "rejected" | "generating" | null;

interface SaleOrder {
  id: string;
  origin: "site" | "olist";
  createdAt: string;
  saleOrderNumber: string | null;
  total: number;
  currency: string;
  situation: string;
  items: Array<{ title: string; quantity: number; unitPrice: number; imageUrl: string | null }>;
  trackingCode: string | null;
  invoice: { status: InvoiceStatus; number: string | null; url: string | null };
  payment: {
    provider: "asaas" | "olist" | null;
    status: string | null;
    dueDate: string | null;
    boletoUrl: string | null;
  };
}

const COMPLETED_STATUSES = ["credit_approved", "shopify_created"];

/** Conta da Olist ("aberto", "pago"...) no mesmo vocabulário de `payments`. */
function receivableStatus(status: string | null, dueDate: string | null): string | null {
  const value = String(status || "").toLowerCase();
  if (!value) return null;
  if (value === "pago") return "received";
  if (value === "cancelado" || value === "cancelada") return "cancelled";
  if (value === "parcial") return "processing";
  const match = String(dueDate || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const due = match ? Date.parse(`${match[3]}-${match[2]}-${match[1]}T23:59:59-03:00`) : NaN;
  return Number.isFinite(due) && due < Date.now() ? "overdue" : "pending";
}

/** "dd/mm/yyyy" -> "yyyy-mm-dd", como o due_date de `payments`. */
function isoDueDate(value: string | null): string | null {
  const match = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : value || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "GET") return errorResponse("Método não permitido", 405);
  const authResult = await requireUser(req);
  if (!authResult.ok) return authResult.response;
  const userId = authResult.auth.userId;

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const [profileResult, sessionsResult, internalResult] = await Promise.all([
      admin.from("profiles").select("is_franchisee").eq("user_id", userId).maybeSingle(),
      admin.from("checkout_sessions")
        .select(
          "id,created_at,status,customer_type,total,currency,items_snapshot,olist_order_id,olist_order_number,olist_invoice_id,olist_invoice_number,olist_invoice_url,olist_invoice_status",
        )
        .eq("user_id", userId)
        .in("status", COMPLETED_STATUSES)
        .order("created_at", { ascending: false })
        .limit(100),
      admin.from("sales_orders")
        .select(
          "id,created_at,order_date,olist_order_number,total,situation,items,tracking_code,invoice_id,invoice_number,invoice_url,invoice_status,receivable_status,receivable_due_date,boleto_url,customer_type",
        )
        .eq("user_id", userId)
        .order("order_date", { ascending: false, nullsFirst: false })
        .limit(100),
    ]);
    if (profileResult.error) throw profileResult.error;
    if (sessionsResult.error) throw sessionsResult.error;
    if (internalResult.error) throw internalResult.error;

    // Status "credit_approved" é exclusivo de franquia; "shopify_created" é de cliente.
    const sessions = (sessionsResult.data ?? []).filter((session) =>
      session.customer_type === "franchise"
        ? session.status === "credit_approved"
        : session.status === "shopify_created"
    );

    // Notas antigas sem link salvo: recupera na Olist e grava (até 5 por acesso).
    const olistToken = Deno.env.get("OLIST_API_TOKEN") || Deno.env.get("TINY_API_TOKEN") || "";
    if (olistToken) {
      await Promise.all(
        sessions
          .filter((session) => session.olist_invoice_id && !session.olist_invoice_url)
          .slice(0, 5)
          .map(async (session) => {
            try {
              const invoice = await getOlistInvoice(String(session.olist_invoice_id), olistToken);
              if (!invoice.accessUrl && !invoice.number) return;
              session.olist_invoice_url = invoice.accessUrl || null;
              session.olist_invoice_number = invoice.number || session.olist_invoice_number;
              await admin.from("checkout_sessions").update({
                olist_invoice_url: session.olist_invoice_url,
                olist_invoice_number: session.olist_invoice_number,
              }).eq("id", session.id);
            } catch (invoiceError) {
              console.error(`sales-orders nota ${session.olist_invoice_id}:`, invoiceError);
            }
          }),
      );
    }

    const sessionIds = sessions.map((session) => session.id);
    const latestPayment = new Map<string, Record<string, any>>();
    if (sessionIds.length) {
      // leitura-limitada: pagamentos das até 100 vendas acima
      const { data: payments, error } = await admin.from("payments")
        .select("checkout_session_id,provider,status,due_date,provider_payment_url,created_at")
        .in("checkout_session_id", sessionIds)
        .order("created_at", { ascending: false });
      if (error) throw error;
      for (const payment of payments ?? []) {
        if (!latestPayment.has(payment.checkout_session_id)) {
          latestPayment.set(payment.checkout_session_id, payment);
        }
      }
    }

    const siteOrders: SaleOrder[] = sessions.map((session) => {
      const payment = latestPayment.get(session.id);
      const items = Array.isArray(session.items_snapshot) ? session.items_snapshot : [];
      return {
        id: session.id,
        origin: "site",
        createdAt: session.created_at,
        saleOrderNumber: session.olist_order_number || null,
        total: Number(session.total) || 0,
        currency: session.currency || "BRL",
        situation: session.customer_type === "franchise" ? "Aprovado" : "Pago",
        items: items.map((item: Record<string, any>) => ({
          title: [item.productTitle, item.variantTitle && item.variantTitle !== "Default Title"
            ? item.variantTitle
            : null].filter(Boolean).join(" - ") || "Produto",
          quantity: Number(item.quantity) || 0,
          unitPrice: Number(item.unitPrice) || 0,
          imageUrl: item.imageUrl || null,
        })),
        trackingCode: null,
        invoice: {
          status: (session.olist_invoice_status as InvoiceStatus) ?? null,
          number: session.olist_invoice_number || null,
          url: session.olist_invoice_url || null,
        },
        payment: {
          provider: payment?.provider === "olist" ? "olist" : payment?.provider === "asaas" ? "asaas" : null,
          status: payment?.status || null,
          dueDate: payment?.due_date || null,
          boletoUrl: payment?.provider === "olist" ? payment?.provider_payment_url || null : null,
        },
      };
    });

    const internalOrders: SaleOrder[] = (internalResult.data ?? []).map((order) => ({
      id: order.id,
      origin: "olist",
      createdAt: order.order_date ? `${order.order_date}T12:00:00-03:00` : order.created_at,
      saleOrderNumber: order.olist_order_number || null,
      total: Number(order.total) || 0,
      currency: "BRL",
      situation: order.situation || "Em andamento",
      items: (Array.isArray(order.items) ? order.items : []).map((item: Record<string, any>) => ({
        title: item.description || "Produto",
        quantity: Number(item.quantity) || 0,
        unitPrice: Number(item.unitPrice) || 0,
        imageUrl: null,
      })),
      trackingCode: order.tracking_code || null,
      invoice: {
        status: (order.invoice_status as InvoiceStatus) ?? null,
        number: order.invoice_number || null,
        url: order.invoice_url || null,
      },
      payment: order.customer_type === "franchise"
        ? {
          provider: "olist",
          status: receivableStatus(order.receivable_status, order.receivable_due_date),
          dueDate: isoDueDate(order.receivable_due_date),
          boletoUrl: order.boleto_url || null,
        }
        : { provider: null, status: null, dueDate: null, boletoUrl: null },
    }));

    const orders = [...siteOrders, ...internalOrders]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return jsonResponse({ orders, isFranchisee: Boolean(profileResult.data?.is_franchisee) });
  } catch (error) {
    console.error("sales-orders:", error);
    return errorResponse("Não foi possível carregar seus pedidos", 500);
  }
});
