# Roadmap — correção webhook retirada (03/09/2026)

## Entrar com São Francisco (10/11/2026)
- [x] Adicionar botão OIDC e retorno público com sessão validada, sem alterar preços; apresentação desktop/mobile e cancelamento conferidos
- [ ] Ativar OIDC nas configurações de autenticação — depende do usuário salvar o novo segredo; consulta em 10/11 retornou provedor não encontrado
- [ ] Testar consentimento e retorno com cliente São Francisco — depende da ativação e de sessão de cliente no provedor

- [ ] 1. "Reenviar último" só aceita pedido comprovadamente de retirada (mesma regra do webhook)
- [ ] 2. Não apagar webhooks antigos (manter até o fim)
- [ ] 3. Criar 1 webhook manual de teste (orders/create) — usuário, no painel Shopify
- [ ] 4. Atualizar SHOPIFY_WEBHOOK_SECRET (formulário seguro)
- [ ] 5. Pedido controlado: HMAC valid, 200, Meta ok, código gravado
- [ ] 6. Criar demais tópicos (fulfillments/create, line_items_prepared_for_pickup)
- [ ] 7. Remover assinaturas antigas via API + fulfillments/update
- [ ] 8. Sem monitor permanente; sem segredo em log
- [ ] 9. Registrar resultado/IDs/rollback (docs/)
- [ ] #1123: confirmar entrega, remover "Codigo de retirada" preservando demais, avisar operação

## Checkout — escopos de estoque Shopify (11/09/2026)

- [x] Registrar falha técnica de permissão no administrativo sem expor detalhes ao cliente
- [x] Manter bloqueio de venda quando o estoque não puder ser confirmado
- [x] Publicar `checkout-prepare` e confirmar versão `2026-09-11.1`
- [x] Incluir `read_products` e `read_inventory` no app Shopify e reinstalar
- [x] Confirmar que o token gerenciado de produção foi renovado e pertence ao app TudoPraPet Clube
- [ ] Confirmar em produção a criação do Draft Order (leitura de produto e estoque já validada)

## Assinante custo + 6% (28/09/2026)
- [x] subscriberPriceFromCost: 1,125 → 1,06 (+ teste)
- [x] Recalcular subscriber_prices no banco
- [x] Publicar admin-olist-cost-sync

## Conta de teste (09/10/2026)
- [x] Excluir pedido de teste #1236 (Olist pedido 209 cancelado + conta estornada; NF-e 000139 fica como "Rejeitada" na Olist — descarte manual; Shopify voided; sessão/cobrança canceladas no banco)
- [x] Criar conta de teste separada: teste@tudoprapet.com.br (franqueada, CNPJ fictício 99.999.999/0001-91, IE isenta, prazo 7 dias, limite R$ 5.000, login confirmado)
