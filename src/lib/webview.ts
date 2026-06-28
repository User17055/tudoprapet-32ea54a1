// Detecta navegadores embutidos (webviews de apps) que o Google bloqueia no OAuth.
export function isInAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  // Apps comuns + heurística "; wv)" do Android WebView + Mobilize/PWA wrappers
  return /FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|WhatsApp|Twitter|TikTok|Snapchat|Pinterest|LinkedInApp|Mobilize|; wv\)|\(iPhone.*Mobile.*Safari.*\) AppleWebKit/i.test(ua)
    && !/Chrome\/[.0-9]+ (Mobile )?Safari/.test(ua.replace(/; wv\)/, ''))
    || /FBAN|FBAV|Instagram|Line\/|MicroMessenger|WhatsApp|TikTok|Mobilize|; wv\)/i.test(ua);
}

export function getExternalBrowserUrl(url: string): string {
  if (typeof navigator === 'undefined') return url;
  const ua = navigator.userAgent || '';
  const isAndroid = /Android/i.test(ua);
  const cleanUrl = url.replace(/^https?:\/\//, '');

  if (isAndroid) {
    const fallback = encodeURIComponent(url);
    return `intent://${cleanUrl}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${fallback};end`;
  }

  return url;
}

// Abre a URL no navegador externo do sistema (Chrome no Android, Safari no iOS).
export function openInExternalBrowser(url: string) {
  if (typeof window === 'undefined') return;
  const externalUrl = getExternalBrowserUrl(url);

  const link = document.createElement('a');
  link.href = externalUrl;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => {
    window.location.href = externalUrl;
  }, 300);
}
