Deno.serve(async () => {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/olist-reconcile-franchise`;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ source: "manual" }),
  });
  return new Response(await r.text(), { status: r.status, headers: { "Content-Type": "application/json" } });
});
