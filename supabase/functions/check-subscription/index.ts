import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseKey) throw new Error("Supabase config missing");

    // O e-mail vem do JWT, não do corpo: sem isso qualquer um poderia consultar
    // a associação de terceiros. O frontend ainda envia { email } no body — ignorado.
    const authResult = await requireUser(req);
    if (!authResult.ok) return authResult.response;

    const email = authResult.auth.email;
    if (!email) throw new Error("Email is required");

    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data, error } = await supabase
      .from("club_members")
      .select("id, is_active")
      .eq("email", email.toLowerCase())
      .eq("is_active", true)
      .maybeSingle();

    if (error) throw error;

    return new Response(
      JSON.stringify({ subscribed: !!data }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
