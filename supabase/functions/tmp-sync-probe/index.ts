// Temporário: diagnostica acesso/branches no GitHub. Protegido por PRINT_AGENT_TOKEN.
Deno.serve(async (req) => {
  if (req.headers.get("x-print-agent-token") !== Deno.env.get("PRINT_AGENT_TOKEN")) {
    return new Response("no", { status: 401 });
  }
  const repo = Deno.env.get("GITHUB_REPO") || "";
  const token = Deno.env.get("GITHUB_TOKEN") || undefined;
  const h = { Accept: "application/vnd.github+json", "User-Agent": "probe", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const out: Record<string, unknown> = { repo_shape: repo.split("/").length === 2, has_token: Boolean(token) };
  const r1 = await fetch(`https://api.github.com/repos/${repo}`, { headers: h });
  out.repo_status = r1.status;
  if (r1.ok) {
    const j = await r1.json();
    out.default_branch = j.default_branch;
    out.private = j.private;
    const r2 = await fetch(`https://api.github.com/repos/${repo}/branches?per_page=100`, { headers: h });
    out.branches_status = r2.status;
    if (r2.ok) out.branches = (await r2.json()).map((b: any) => b.name);
  } else {
    out.repo_body = (await r1.text()).slice(0, 200);
    const r3 = await fetch("https://api.github.com/user", { headers: h });
    out.user_status = r3.status;
    if (r3.ok) out.login = (await r3.json()).login;
  }
  return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
});
