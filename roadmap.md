# Roadmap — correção webhook retirada (03/09/2026)

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
