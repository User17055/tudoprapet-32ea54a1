// Temporário: valida o acesso ao GitHub. Protegido por PRINT_AGENT_TOKEN.
Deno.serve(async (req) => {
  if (req.headers.get("x-print-agent-token") !== Deno.env.get("PRINT_AGENT_TOKEN")) {
    return new Response("no", { status: 401 });
  }
  const repo = Deno.env.get("GITHUB_REPO");
  const token = Deno.env.get("GITHUB_TOKEN") || undefined;
  const branch = Deno.env.get("GIT_WORK_BRANCH") || "Andre";
  const res = await fetch(`https://api.github.com/repos/${repo}/compare/main...${branch}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "probe", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const body = await res.text();
  return new Response(JSON.stringify({ repo_set: Boolean(repo), status: res.status, snippet: body.slice(0, 400) }), { headers: { "Content-Type": "application/json" } });
});
