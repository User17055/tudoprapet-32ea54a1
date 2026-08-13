import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { corsHeaders, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { canAccessCheckout, optionalCheckoutUser } from "../_shared/checkout-access.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Método não permitido", 405);

  try {
    const auth = await optionalCheckoutUser(req);
    if (auth.invalidAuthorization) return errorResponse("Sessão inválida", 401);
    const body = await req.json() as Record<string, unknown>;
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const accessToken = typeof body.accessToken === "string" ? body.accessToken : null;
    if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return errorResponse("Checkout inválido", 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: session, error } = await admin.from("checkout_sessions")
      .select("id,user_id,status,customer_type,currency,subtotal,discount,shipping_amount,total,shipping_method,shipping_code,items_snapshot,shopify_order_id,anonymous_access_token_hash,anonymous_access_token_expires_at,created_at,updated_at")
      .eq("id", sessionId).single();
    if (error || !session) return errorResponse("Checkout não encontrado", 404);
    if (!(await canAccessCheckout(session, auth.user?.id ?? null, accessToken))) {
      return errorResponse("Acesso negado ao checkout", 403);
    }

    const { data: payment } = await admin.from("payments")
      .select("id,attempt_number,method,status,amount,due_date,provider_expires_at,created_at")
      .eq("checkout_session_id", sessionId)
      .order("attempt_number", { ascending: false })
      .limit(1).maybeSingle();

    return jsonResponse({
      id: session.id,
      status: session.status,
      customerType: session.customer_type,
      currency: session.currency,
      summary: {
        subtotal: session.subtotal,
        discount: session.discount,
        shippingAmount: session.shipping_amount,
        total: session.total,
        shippingMethod: session.shipping_method,
        shippingCode: session.shipping_code,
        items: session.items_snapshot,
      },
      payment: payment ? {
        id: payment.id,
        attemptNumber: payment.attempt_number,
        method: payment.method,
        status: payment.status,
        amount: payment.amount,
        dueDate: payment.due_date,
        expiresAt: payment.provider_expires_at,
      } : null,
      orderId: session.shopify_order_id,
      updatedAt: session.updated_at,
    });
  } catch (error) {
    console.error("checkout-status:", error);
    return errorResponse("Não foi possível consultar o checkout", 500);
  }
});

