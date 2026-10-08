// Temporária: dispara a conciliação Olist manualmente. Apagar após uso.
Deno.serve(async () => {
  const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/olist-reconcile-franchise`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ source: "manual" }),
  });
  return new Response(JSON.stringify({ status: r.status, body: await r.json().catch(() => null) }), {
    headers: { "Content-Type": "application/json" },
  });
});
