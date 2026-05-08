import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, key);
    const { users } = await req.json() as { users: { email: string; password: string; name?: string }[] };

    let created = 0, skipped = 0, errors: string[] = [];
    for (const u of users) {
      if (!u.email || !u.password) { skipped++; continue; }
      const pwd = u.password.length < 6 ? u.password.padEnd(6, "0") : u.password;
      const { error } = await admin.auth.admin.createUser({
        email: u.email,
        password: pwd,
        email_confirm: true,
        user_metadata: { name: u.name ?? null },
      });
      if (error) {
        if (/already.*registered|already exists|duplicate/i.test(error.message)) skipped++;
        else errors.push(`${u.email}: ${error.message}`);
      } else created++;
    }
    return new Response(JSON.stringify({ created, skipped, errorCount: errors.length, errors: errors.slice(0, 10) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
