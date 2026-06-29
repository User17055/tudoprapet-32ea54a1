import { Capacitor } from '@capacitor/core';
import { GoogleAuth } from '@codetrix-studio/capacitor-google-auth';
import { supabase } from '@/integrations/supabase/client';
import { lovable } from '@/integrations/lovable';

let initialized = false;
function ensureInit() {
  if (initialized) return;
  // No iOS/Android os valores são lidos do capacitor.config (GoogleAuth plugin).
  // No web/PWA não usamos este caminho — usamos o OAuth gerenciado do Lovable.
  GoogleAuth.initialize();
  initialized = true;
}

export const isNativeApp = () =>
  Capacitor.isNativePlatform?.() ?? false;

/**
 * Login com Google.
 * - App nativo (iOS/Android): usa o seletor de contas do sistema via
 *   @codetrix-studio/capacitor-google-auth e troca o idToken por uma
 *   sessão Supabase com signInWithIdToken.
 * - Web/PWA: usa o fluxo OAuth gerenciado do Lovable Cloud.
 */
export async function signInWithGoogle(): Promise<{ success: boolean; error?: string }> {
  try {
    if (isNativeApp()) {
      ensureInit();
      const result = await GoogleAuth.signIn();
      const idToken = result.authentication?.idToken;
      if (!idToken) {
        return { success: false, error: 'Não foi possível obter o token do Google.' };
      }
      const { error } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: idToken,
      });
      if (error) return { success: false, error: error.message };
      return { success: true };
    }

    // Web/PWA → fluxo gerenciado
    const result = await lovable.auth.signInWithOAuth('google', {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      return { success: false, error: (result.error as Error).message ?? 'Erro no login com Google.' };
    }
    // Em web normalmente redireciona; mantemos retorno de sucesso “otimista”.
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Erro ao entrar com o Google.' };
  }
}

export async function signOutGoogle() {
  if (isNativeApp()) {
    try { await GoogleAuth.signOut(); } catch { /* ignore */ }
  }
}
