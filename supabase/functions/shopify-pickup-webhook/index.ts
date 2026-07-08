import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-shopify-hmac-sha256, x-shopify-topic, x-shopify-shop-domain",
};

const STORE_NAME = "Lis-onTech";
const STORE_ADDRESS = "";

function generatePickupCode(): string {
  // 6 digits, no leading zero for readability
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function verifyShopifyHmac(rawBody: string, hmacHeader: string | null, secret: string): Promise<boolean> {
  if (!hmacHeader) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return b64 === hmacHeader;
}

function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  // Assume Brazil if no country code
  return digits.startsWith("55") ? digits : `55${digits}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const rawBody = await req.text();
    const topic = req.headers.get("x-shopify-topic") || "";
    const hmac = req.headers.get("x-shopify-hmac-sha256");
    const webhookSecret = Deno.env.get("SHOPIFY_WEBHOOK_SECRET");

    // Verify HMAC only if secret is configured (optional in dev)
    if (webhookSecret) {
      const valid = await verifyShopifyHmac(rawBody, hmac, webhookSecret);
      if (!valid) {
        console.error("Invalid Shopify HMAC signature");
        return new Response(JSON.stringify({ error: "invalid signature" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const payload = JSON.parse(rawBody);
    console.log(`Shopify webhook topic=${topic} order=${payload.id || payload.order_id}`);

    // Detect ready-for-pickup signal from either topic:
    // - fulfillment_orders/ready_to_pickup  (native)
    // - orders/updated  (fallback: check fulfillment_status or tags)
    const isReadyToPickup =
      topic === "fulfillment_orders/ready_to_pickup" ||
      payload?.fulfillment_status === "ready_for_pickup" ||
      String(payload?.tags || "").toLowerCase().includes("pronto-retirada") ||
      String(payload?.tags || "").toLowerCase().includes("ready-for-pickup");

    if (!isReadyToPickup) {
      return new Response(JSON.stringify({ ignored: true, reason: "not a ready-to-pickup event" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Extract fields (works for both order webhooks and fulfillment_order webhooks)
    const shopifyOrderId = String(payload.order_id || payload.id || "");
    const orderNumber = String(payload.order_number || payload.name || payload.order_id || "");
    const customer = payload.customer || {};
    const shippingAddress = payload.shipping_address || {};
    const customerName =
      `${customer.first_name || shippingAddress.first_name || ""} ${customer.last_name || shippingAddress.last_name || ""}`.trim()
      || customer.name || null;
    const customerEmail = customer.email || payload.email || null;
    const customerPhone = normalizePhone(customer.phone || shippingAddress.phone || payload.phone);

    if (!shopifyOrderId) {
      return new Response(JSON.stringify({ error: "missing order id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Reuse code if this order already has one (idempotency)
    const { data: existing } = await supabase
      .from("pickup_codes")
      .select("*")
      .eq("shopify_order_id", shopifyOrderId)
      .maybeSingle();

    let code: string;
    let recordId: string;

    if (existing) {
      code = existing.code;
      recordId = existing.id;
      console.log(`Reusing existing code ${code} for order ${shopifyOrderId}`);
    } else {
      // Generate unique code (retry a few times on collision)
      code = generatePickupCode();
      for (let i = 0; i < 5; i++) {
        const { data: clash } = await supabase
          .from("pickup_codes")
          .select("id")
          .eq("code", code)
          .maybeSingle();
        if (!clash) break;
        code = generatePickupCode();
      }

      const { data: inserted, error: insertErr } = await supabase
        .from("pickup_codes")
        .insert({
          shopify_order_id: shopifyOrderId,
          shopify_order_number: orderNumber,
          code,
          customer_name: customerName,
          customer_phone: customerPhone,
          customer_email: customerEmail,
          status: "ready",
          raw_order: payload,
        })
        .select()
        .single();
      if (insertErr) throw insertErr;
      recordId = inserted.id;
    }

    // Call external PHP system
    const baseUrl = Deno.env.get("EXTERNAL_API_BASE_URL");
    const token = Deno.env.get("EXTERNAL_API_TOKEN");

    if (baseUrl && customerPhone) {
      const endpoint = `${baseUrl.replace(/\/$/, "")}/api/whatsapp/send`;
      const outbound = {
        event: "pronto_retirada",
        template: "pronto_retirada",
        phone: customerPhone,
        variables: {
          customer_name: customerName || "Cliente",
          order_number: orderNumber,
          pickup_code: code,
          store_name: STORE_NAME,
          store_address: STORE_ADDRESS,
        },
        meta: {
          shopify_order_id: shopifyOrderId,
          customer_email: customerEmail,
        },
      };

      try {
        const resp = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(outbound),
        });
        const respText = await resp.text();
        if (!resp.ok) {
          console.error(`External API error ${resp.status}: ${respText}`);
          await supabase
            .from("pickup_codes")
            .update({ whatsapp_error: `HTTP ${resp.status}: ${respText.slice(0, 500)}` })
            .eq("id", recordId);
        } else {
          console.log(`WhatsApp dispatched for order ${orderNumber} code ${code}`);
          await supabase
            .from("pickup_codes")
            .update({ whatsapp_sent_at: new Date().toISOString(), whatsapp_error: null })
            .eq("id", recordId);
        }
      } catch (e) {
        console.error("Failed to call external API:", e);
        await supabase
          .from("pickup_codes")
          .update({ whatsapp_error: String(e).slice(0, 500) })
          .eq("id", recordId);
      }
    } else if (!customerPhone) {
      console.warn(`No customer phone for order ${shopifyOrderId}, skipping WhatsApp`);
      await supabase
        .from("pickup_codes")
        .update({ whatsapp_error: "Cliente sem telefone" })
        .eq("id", recordId);
    }

    return new Response(JSON.stringify({ ok: true, code, order: orderNumber }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
