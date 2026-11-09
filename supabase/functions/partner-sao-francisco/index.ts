// API do Plano São Francisco: cria/acha cliente e coloca/tira do grupo de preço do Clube.
// Autenticação: header "x-api-key" = secret SAO_FRANCISCO_API_KEY (comparação em tempo constante).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const SOURCE = "sao_francisco";
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function safeEqual(a: string, b: string) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function isValidCpf(v: string) {
  const c = v.replace(/\D/g, "");
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  for (const n of [9, 10]) {
    let t = 0;
    for (let i = 0; i < n; i++) t += Number(c[i]) * (n + 1 - i);
    if (((t * 10) % 11) % 10 !== Number(c[n])) return false;
  }
  return true;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });
  const expected = Deno.env.get("SAO_FRANCISCO_API_KEY") ?? "";
  const got = req.headers.get("x-api-key") ?? "";
  if (expected.length < 32 || !safeEqual(got, expected)) return json(401, { ok: false, error: "unauthorized" });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { ok: false, error: "invalid_json" }); }
  const action = String(body.action ?? "");
  const email = String(body.email ?? "").trim().toLowerCase();
  const cpf = String(body.cpf ?? "").replace(/\D/g, "");
  const name = String(body.name ?? "").trim();
  const phone = String(body.phone ?? "").replace(/\D/g, "");

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Acha a conta pelo CPF, depois pelo e-mail.
  async function findProfile() {
    if (cpf) {
      const { data } = await admin.from("profiles").select("user_id,email,name").eq("cpf", cpf).maybeSingle();
      if (data) return data;
    }
    if (email) {
      const { data } = await admin.from("profiles").select("user_id,email,name").ilike("email", email).maybeSingle();
      if (data) return data;
    }
    return null;
  }

  try {
    if (action === "activate") {
      const errors: Record<string, string> = {};
      if (!name || name.length > 200) errors.name = "required";
      if (!isValidCpf(cpf)) errors.cpf = "invalid";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) errors.email = "invalid";
      if (phone.length < 10 || phone.length > 13) errors.phone = "invalid";
      if (Object.keys(errors).length) return json(400, { ok: false, error: "validation_error", fields: errors });

      let profile = await findProfile();
      let accountCreated = false;
      if (!profile) {
        const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
          data: { name, cpf, person_type: "individual", acquisition_source: SOURCE },
          redirectTo: "https://tudoprapet.com.br/redefinir-senha",
        });
        if (error) {
          console.error("invite failed", error.message);
          return json(409, { ok: false, error: "account_creation_failed" });
        }
        accountCreated = true;
        profile = { user_id: data.user!.id, email, name };
      }
      const memberEmail = (profile.email || email).toLowerCase();
      const { data: existing } = await admin.from("club_members").select("id,source").ilike("email", memberEmail).maybeSingle();
      if (existing) {
        await admin.from("club_members").update({ is_active: true, cpf, phone, name, updated_at: new Date().toISOString() }).eq("id", existing.id);
      } else {
        const { error } = await admin.from("club_members").insert({ email: memberEmail, name, cpf, phone, source: SOURCE, is_active: true });
        if (error) throw error;
      }
      return json(200, { ok: true, status: "active", user_id: profile.user_id, email: memberEmail, account_created: accountCreated });
    }

    if (action === "deactivate" || action === "status") {
      if (!cpf && !email) return json(400, { ok: false, error: "validation_error", fields: { cpf: "cpf_or_email_required" } });
      const profile = await findProfile();
      const memberEmail = (profile?.email || email).toLowerCase();
      const { data: member } = memberEmail
        ? await admin.from("club_members").select("id,is_active,source").ilike("email", memberEmail).maybeSingle()
        : { data: null };
      if (!member) return json(404, { ok: false, error: "member_not_found" });
      if (action === "status") return json(200, { ok: true, status: member.is_active ? "active" : "inactive", email: memberEmail });
      // Não remove quem foi colocado no Clube manualmente pela loja.
      if (member.source !== SOURCE) return json(200, { ok: true, status: member.is_active ? "active" : "inactive", note: "managed_by_store" });
      await admin.from("club_members").update({ is_active: false, updated_at: new Date().toISOString() }).eq("id", member.id);
      return json(200, { ok: true, status: "inactive", email: memberEmail });
    }

    return json(400, { ok: false, error: "unknown_action" });
  } catch (e) {
    console.error("partner-sao-francisco error", e instanceof Error ? e.message : e);
    return json(500, { ok: false, error: "internal_error" });
  }
});
