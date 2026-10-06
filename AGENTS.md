# AGENTS.md

- Franchise checkout: only Olist order/receivable creation or Shopify completion may block; NF-e generation/issuance errors are recorded in checkout_sessions.olist_invoice_status and retried by olist-reconcile-franchise. Why: fiscal rejections must not hold up the sale.
