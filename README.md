# TudoPraPet

## Recuperacao de senha por SMTP Locaweb

A tela `src/pages/ForgotPassword.tsx` usa o fluxo nativo do Supabase Auth:

```ts
supabase.auth.resetPasswordForEmail(email, {
  redirectTo: `${VITE_SITE_URL}/redefinir-senha`,
});
```

Para o e-mail sair pelo endereco da Locaweb, configure o SMTP no painel do Supabase:

1. Acesse o projeto no Supabase.
2. Va em **Authentication > Emails > SMTP Settings**.
3. Ative **Custom SMTP**.
4. Preencha:
   - **Host**: `email-ssl.com.br`
   - **Port**: `465`
   - **Encryption**: `SSL/TLS`
   - **Username**: o e-mail completo da Locaweb, por exemplo `contato@seudominio.com.br`
   - **Password**: a senha desse e-mail na Locaweb
   - **Sender email**: o mesmo e-mail usado no login SMTP
   - **Sender name**: `TudoPraPet`
5. Salve e envie um teste pelo Supabase.

Tambem configure a URL publica do site no `.env`:

```env
VITE_SITE_URL="https://seu-dominio.com.br"
```

No painel do Supabase, confira tambem **Authentication > URL Configuration**:

- **Site URL**: `https://seu-dominio.com.br`
- **Redirect URLs**: `https://seu-dominio.com.br/redefinir-senha`

As credenciais SMTP nunca devem ficar no `.env` do frontend ou em variaveis `VITE_*`, porque tudo que comeca com `VITE_` pode ser exposto no navegador. Coloque usuario e senha SMTP somente no painel do Supabase.
