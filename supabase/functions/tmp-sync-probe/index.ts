// Temporário: valida compare main...Andre no repositório acessível. Protegido por PRINT_AGENT_TOKEN.
Deno.serve(async (req) => {
  if (req.headers.get("x-print-agent-token") !== Deno.env.get("PRINT_AGENT_TOKEN")) {
    return new Response("no", { status: 401 });
  }
  const token = Deno.env.get("GITHUB_TOKEN") || undefined;
  const h = {
    Accept: "application/vnd.github+json",
    "User-Agent": "probe",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const repos = await (await fetch("https://api.github.com/user/repos?per_page=100&sort=updated", { headers: h })).json();
  const repo = repos[0]?.full_name;
  const branches = await (await fetch(`https://api.github.com/repos/${repo}/branches?per_page=100`, { headers: h })).json();
  const r = await fetch(`https://api.github.com/repos/${repo}/compare/main...Andre`, { headers: h });
  const body = await r.text();
  return new Response(
    JSON.stringify({
      repo,
      branches: Array.isArray(branches) ? branches.map((b: any) => b.name) : branches,
      compare_status: r.status,
      snippet: body.slice(0, 300),
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
