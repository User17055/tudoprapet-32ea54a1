import { createClient, type SupabaseClient, type User } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { timingSafeEqual } from "./webhook.ts";

export interface OptionalCheckoutUser {
  user: User | null;
  client: SupabaseClient | null;
  invalidAuthorization: boolean;
}

/** Cabeçalho em que o cliente declara o que ele ACHA que é. Ver SESSION_CLAIM. */
export const SESSION_CLAIM_HEADER = "x-tpp-session";

/**
 * O que o navegador declarou sobre a própria sessão.
 *
 * Existe porque o servidor, sozinho, NÃO consegue distinguir um visitante de
 * alguém cuja sessão morreu. Medido no código do SDK em 01/09/2026:
 *
 *   // supabase-js, _getAccessToken()
 *   return data.session?.access_token ?? this.supabaseKey
 *
 * Sem sessão viva o SDK manda a CHAVE PÚBLICA no Authorization -- exatamente o
 * mesmo header de quem nunca logou. Os dois casos chegam aqui idênticos, byte a
 * byte. Quem sabe a diferença é o navegador, que ainda tem o `user` na tela.
 *
 * Por isso a informação vem declarada, e não deduzida.
 *
 * `unknown` (cabeçalho ausente) preserva o comportamento antigo de propósito: as
 * functions publicam antes do frontend, e durante essa janela nenhum cliente
 * manda o cabeçalho. Tratar ausência como suspeita derrubaria o checkout inteiro
 * no intervalo entre as duas publicações.
 */
export type SessionClaim = "user" | "guest" | "unknown";

export function readSessionClaim(req: Request): SessionClaim {
  const raw = req.headers.get(SESSION_CLAIM_HEADER)?.trim().toLowerCase();
  return raw === "user" ? "user" : raw === "guest" ? "guest" : "unknown";
}

export async function optionalCheckoutUser(req: Request): Promise<OptionalCheckoutUser> {
  const claim = readSessionClaim(req);
  const authorization = req.headers.get("Authorization");
  if (!authorization) return { user: null, client: null, invalidAuthorization: false };

  const client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!,
    { global: { headers: { Authorization: authorization } } },
  );
  const { data: { user }, error } = await client.auth.getUser();
  // O SDK envia a chave pública como Authorization em chamadas anônimas. Ela
  // passa pelo gateway, mas não representa usuário; nesse caso seguimos como
  // guest -- A MENOS que o navegador tenha declarado ter sessão. Aí as duas
  // versões se contradizem, e a contradição é o sinal: a sessão morreu entre
  // abrir a tela e enviar o pedido.
  //
  // Deixar passar como guest é o que produzia o pior defeito deste checkout: o
  // assinante do Clube era cobrado preço cheio, porque `customerType` só vira
  // "subscriber" dentro de `if (auth.user)`, e nada aparecia na tela nem no log.
  if (error || !user) {
    return { user: null, client, invalidAuthorization: claim === "user" };
  }
  return { user, client, invalidAuthorization: false };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function newCheckoutAccessToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export async function hashCheckoutAccessToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return bytesToBase64Url(new Uint8Array(digest));
}

export async function canAccessCheckout(
  session: { user_id: string | null; anonymous_access_token_hash: string | null; anonymous_access_token_expires_at: string | null },
  userId: string | null,
  rawToken: string | null,
): Promise<boolean> {
  if (session.user_id && userId === session.user_id) return true;
  if (!rawToken || !session.anonymous_access_token_hash) return false;
  if (session.anonymous_access_token_expires_at &&
    new Date(session.anonymous_access_token_expires_at).getTime() <= Date.now()) return false;
  return timingSafeEqual(
    await hashCheckoutAccessToken(rawToken),
    session.anonymous_access_token_hash,
  );
}
