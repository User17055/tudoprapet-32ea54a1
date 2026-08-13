import { createClient, type SupabaseClient, type User } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { timingSafeEqual } from "./webhook.ts";

export interface OptionalCheckoutUser {
  user: User | null;
  client: SupabaseClient | null;
  invalidAuthorization: boolean;
}

export async function optionalCheckoutUser(req: Request): Promise<OptionalCheckoutUser> {
  const authorization = req.headers.get("Authorization");
  if (!authorization) return { user: null, client: null, invalidAuthorization: false };

  const client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!,
    { global: { headers: { Authorization: authorization } } },
  );
  const { data: { user }, error } = await client.auth.getUser();
  // O SDK envia a chave pública como Authorization em chamadas anônimas. Ela
  // passa pelo gateway, mas não representa usuário; nesse caso seguimos como guest.
  if (error || !user) return { user: null, client, invalidAuthorization: false };
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
