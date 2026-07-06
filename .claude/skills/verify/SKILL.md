---
name: verify
description: How to run and drive the TudoPraPet storefront to verify changes end-to-end (Vite + React + Shopify Storefront API).
---

# Verifying changes in this repo

## Build & launch
- Dev server: `npm run dev` → http://localhost:8080 (Vite, porta fixa 8080).
- Typecheck: `npx tsc --noEmit` (rápido, sem erros no baseline).
- O app fala com a loja Shopify real (`petjoy-deals-hb8r9.myshopify.com`) via Storefront API — carrinho, produtos e cupons são reais. Carrinhos criados em teste são descartáveis.

## Driving the UI
- Playwright está em `node_modules` (require com caminho absoluto se o script estiver fora do repo) e o Chromium já está instalado.
- Use `browser.newContext({ viewport })` + `context.newPage()` — o carrinho persiste em `localStorage` (`shopify-cart`), então páginas novas precisam do mesmo context para compartilhar o carrinho.
- Fluxo para popular o carrinho: `/catalogo` → clicar `[aria-label="Adicionar ao carrinho"]` → esperar toast "Adicionado ao carrinho!". O drawer abre sozinho no primeiro add.
- Mobile vs desktop é decidido por `useIsMobile()` (matchMedia): viewport 390px → página `/carrinho`; 1280px → drawer lateral.

## Gotchas
- O Header monta `<CartDrawer />` DUAS vezes (desktop + mobile). Quando o drawer abre, os dois Sheets abrem juntos → seletores duplicam. Use `.last()` para interagir com o de cima.
- Estado do clube/assinante vem de `useSubscription()` (Supabase); sem login, `isSubscribed` é false.
- Para simular estado persistido, edite `localStorage['shopify-cart']` (JSON com `state.items`, `state.cartId`, `state.discountCode`) e recarregue.
