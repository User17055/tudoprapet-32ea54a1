// Verificação automática de sincronização entre a branch de trabalho (Andre) e a main.
//
// Responde ao painel admin: quais commits da branch ainda não estão na main,
// qual o último commit de cada lado e se o site já publicou aquele código.
//
// Segredos usados (só backend):
//   GITHUB_REPO  -> "dono/repositorio"
//   GITHUB_TOKEN -> opcional; obrigatório se o repositório for privado
//   GIT_WORK_BRANCH -> opcional; padrão "Andre"

import { corsHeaders, FUNCTIONS_VERSION } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/auth.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function gh(path: string, token: string | undefined) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "tudoprapet-sync-check",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`GitHub ${path} falhou [${res.status}]: ${text}`);
    throw new Error(`GitHub ${res.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return auth.response;

    const repo = Deno.env.get("GITHUB_REPO");
    const token = Deno.env.get("GITHUB_TOKEN") || undefined;
    const workBranch = Deno.env.get("GIT_WORK_BRANCH") || "Andre";

    if (!repo || !repo.includes("/")) {
      return json({
        configured: false,
        message:
          'Configure o segredo GITHUB_REPO no formato "dono/repositorio" (e GITHUB_TOKEN se o repositório for privado).',
        functions_version: FUNCTIONS_VERSION,
      });
    }

    // main...work: ahead_by = commits da branch que ainda não estão na main.
    const cmp = await gh(
      `/repos/${repo}/compare/main...${encodeURIComponent(workBranch)}`,
      token,
    );

    const pending = (cmp.commits || []).map((c: any) => ({
      sha: String(c.sha).slice(0, 7),
      message: String(c.commit?.message || "").split("\n")[0],
      author: c.commit?.author?.name ?? null,
      date: c.commit?.author?.date ?? null,
      url: c.html_url ?? null,
    }));

    const [mainBranch, workBranchInfo] = await Promise.all([
      gh(`/repos/${repo}/branches/main`, token),
      gh(`/repos/${repo}/branches/${encodeURIComponent(workBranch)}`, token),
    ]);

    const head = (b: any) => ({
      sha: String(b?.commit?.sha || "").slice(0, 7),
      message: String(b?.commit?.commit?.message || "").split("\n")[0],
      date: b?.commit?.commit?.author?.date ?? null,
    });

    return json({
      configured: true,
      repo,
      work_branch: workBranch,
      // 0 pendentes = tudo que está na branch já foi mesclado na main.
      in_sync: pending.length === 0,
      ahead_by: cmp.ahead_by ?? pending.length,
      behind_by: cmp.behind_by ?? 0,
      pending_commits: pending,
      main: head(mainBranch),
      work: head(workBranchInfo),
      // Versão das edge functions que está realmente rodando em produção.
      functions_version: FUNCTIONS_VERSION,
      checked_at: new Date().toISOString(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("git-sync-status:", msg);
    return json({ error: msg }, 502);
  }
});
