import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { corsHeaders } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";

const PRICE_ID = "price_1TKM1SRPcks7vOIJJByCtDwR";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    // O e-mail vem do JWT; só o nome de exibição continua vindo do corpo.
    const authResult = await requireUser(req);
    if (!authResult.ok) return authResult.response;

    const email = authResult.auth.email;
    if (!email) throw new Error("Email is required");

    const { customerName } = await req.json().catch(() => ({ customerName: undefined }));

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Check if customer already exists
    const customers = await stripe.customers.list({ email, limit: 1 });
    let customerId: string | undefined;

    if (customers.data.length > 0) {
      customerId = customers.data[0].id;

      // Check for active subscription
      const subs = await stripe.subscriptions.list({
        customer: customerId,
        status: "active",
        limit: 1,
      });
      if (subs.data.length > 0) {
        return new Response(
          JSON.stringify({ error: "Você já possui uma assinatura ativa!" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
        );
      }
    }

    const origin = req.headers.get("origin") || "https://tudoprapet.lovable.app";

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : email,
      line_items: [{ price: PRICE_ID, quantity: 1 }],
      mode: "subscription",
      success_url: `${origin}/clube?status=success`,
      cancel_url: `${origin}/clube?status=canceled`,
      metadata: { customer_name: customerName || "" },
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
