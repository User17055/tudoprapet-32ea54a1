# AGENTS.md

- Franchise checkout: only Olist order/receivable creation or Shopify completion may block; NF-e generation/issuance errors are recorded in checkout_sessions.olist_invoice_status and retried by olist-reconcile-franchise. Why: fiscal rejections must not hold up the sale.
- Partner plans (e.g. Plano São Francisco) grant Clube pricing via club_members rows tagged with `source`; the partner API only deactivates rows it created. Why: pricing already reads club_members, so no second pricing path.
- São Francisco sign-in uses Cloud's `custom:app-oidc` provider and a public login callback that revalidates the user before navigation; OIDC claims never grant Clube pricing. Why: provider credentials stay in managed auth settings and plan entitlement remains independent of login.
