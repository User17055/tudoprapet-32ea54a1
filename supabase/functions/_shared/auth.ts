// Autenticação das edge functions.
//
// Regra da casa: a identidade vem SEMPRE do JWT, nunca do corpo da requisição,
// e o service_role só é criado depois da autorização.
//
// Cuidado: `verify_jwt` do Supabase não substitui isto. A anon key é um JWT
// válido e é pública (está no bundle do frontend), então uma function que confia
// só nela está aberta. Ver docs/edge-functions-auth.md.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { errorResponse } from "./cors.ts";

export interface AuthContext {
  /** Cliente autenticado como o usuário da requisição (respeita RLS). */
  supabase: SupabaseClient;
  userId: string;
  email: string | null;
}

export type AuthResult =
  | { ok: true; auth: AuthContext }
  | { ok: false; response: Response };

/** Exige um usuário autenticado de verdade. */
export async function requireUser(req: Request): Promise<AuthResult> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return { ok: false, response: errorResponse("Não autorizado", 401) };
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return { ok: false, response: errorResponse("Não autorizado", 401) };
  }

  return { ok: true, auth: { supabase, userId: user.id, email: user.email ?? null } };
}

/** Exige usuário autenticado E com papel de admin. */
export async function requireAdmin(req: Request): Promise<AuthResult> {
  const result = await requireUser(req);
  if (!result.ok) return result;

  const { data: isAdmin } = await result.auth.supabase.rpc("has_role", {
    _user_id: result.auth.userId,
    _role: "admin",
  });
  if (!isAdmin) {
    return { ok: false, response: errorResponse("Acesso restrito a administradores", 403) };
  }

  return result;
}
