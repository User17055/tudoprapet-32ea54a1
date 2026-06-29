import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.ead90f960fcc495eb89982169728ce1f',
  appName: 'tudoprapet',
  webDir: 'dist',
  server: {
    url: 'https://ead90f96-0fcc-495e-b899-82169728ce1f.lovableproject.com?forceHideBadge=true',
    cleartext: true,
  },
  plugins: {
    GoogleAuth: {
      // Substitua pelo Web Client ID (.apps.googleusercontent.com) criado no
      // Google Cloud Console (tipo: "Aplicativo Web"). Esse mesmo ID também
      // precisa estar configurado no Lovable Cloud em Auth → Google.
      scopes: ['profile', 'email'],
      serverClientId: 'COLE_AQUI_O_WEB_CLIENT_ID.apps.googleusercontent.com',
      forceCodeForRefreshToken: true,
    },
  },
};

export default config;
