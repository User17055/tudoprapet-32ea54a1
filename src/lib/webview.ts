// Detecta navegadores embutidos (webviews de apps) que o Google bloqueia no OAuth.
export function isInAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  // Apps comuns + heurística "; wv)" do Android WebView + Mobilize/PWA wrappers
  return /FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|WhatsApp|Twitter|TikTok|Snapchat|Pinterest|LinkedInApp|Mobilize|; wv\)|\(iPhone.*Mobile.*Safari.*\) AppleWebKit/i.test(ua)
    && !/Chrome\/[.0-9]+ (Mobile )?Safari/.test(ua.replace(/; wv\)/, ''))
    || /FBAN|FBAV|Instagram|Line\/|MicroMessenger|WhatsApp|TikTok|Mobilize|; wv\)/i.test(ua);
}

// Abre a URL no navegador externo do sistema (Chrome no Android, Safari no iOS).
export function openInExternalBrowser(url: string) {
  if (typeof window === 'undefined') return;
  const ua = navigator.userAgent || '';
  const isAndroid = /Android/i.test(ua);
  const cleanUrl = url.replace(/^https?:\/\//, '');

  if (isAndroid) {
    // Intent obriga o Android a abrir no Chrome
    window.location.href = `intent://${cleanUrl}#Intent;scheme=https;package=com.android.chrome;end`;
    return;
  }
  // iOS: tenta forçar o Safari
  window.location.href = `x-safari-https://${cleanUrl}`;
  setTimeout(() => {
    window.location.href = url;
  }, 800);
}
