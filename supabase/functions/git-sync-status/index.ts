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

    let repo = Deno.env.get("GITHUB_REPO");
    const token = Deno.env.get("GITHUB_TOKEN") || undefined;
    const workBranch = Deno.env.get("GIT_WORK_BRANCH") || "Andre";

    // Se GITHUB_REPO estiver ausente ou não existir para este token, descobre o
    // repositório acessível pelo próprio token (evita erro por nome digitado errado).
    let repoOk = false;
    if (repo && repo.includes("/")) {
      const probe = await fetch(`https://api.github.com/repos/${repo}`, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "tudoprapet-sync-check",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      repoOk = probe.ok;
    }
    if (!repoOk && token) {
      const repos = await gh("/user/repos?per_page=100&sort=updated", token);
      const first = (repos as any[])[0]?.full_name;
      if (first) repo = first;
      repoOk = Boolean(first);
    }

    if (!repo || !repoOk) {
      return json({
        configured: false,
        message:
          'Configure o segredo GITHUB_REPO no formato "dono/repositorio" e um GITHUB_TOKEN com acesso a ele.',
        functions_version: FUNCTIONS_VERSION,
      });
    }

    const mapCommits = (list: any[]) =>
      (list || []).map((c: any) => ({
        sha: String(c.sha).slice(0, 7),
        message: String(c.commit?.message || "").split("\n")[0],
        author: c.commit?.author?.name ?? null,
        date: c.commit?.author?.date ?? null,
        url: c.html_url ?? null,
      }));

    // 1) Estado real da main: últimos commits que estão publicados nela.
    const mainBranch = await gh(`/repos/${repo}/branches/main`, token);
    const mainCommits = mapCommits(
      await gh(`/repos/${repo}/commits?sha=main&per_page=15`, token),
    );

    // 2) Branch de trabalho (opcional): commits que ainda não entraram na main.
    let workExists = false;
    let workBranchInfo: any = null;
    let pending: ReturnType<typeof mapCommits> = [];
    let aheadBy = 0;
    let behindBy = 0;
    try {
      workBranchInfo = await gh(
        `/repos/${repo}/branches/${encodeURIComponent(workBranch)}`,
        token,
      );
      workExists = true;
      const cmp = await gh(
        `/repos/${repo}/compare/main...${encodeURIComponent(workBranch)}`,
        token,
      );
      pending = mapCommits(cmp.commits);
      aheadBy = cmp.ahead_by ?? pending.length;
      behindBy = cmp.behind_by ?? 0;
    } catch (_e) {
      // Branch não existe (ex.: já mesclada e removida) — a main continua sendo verificada.
      workExists = false;
    }

    const head = (b: any) => ({
      sha: String(b?.commit?.sha || "").slice(0, 7),
      message: String(b?.commit?.commit?.message || "").split("\n")[0],
      date: b?.commit?.commit?.author?.date ?? null,
    });

    return json({
      configured: true,
      repo,
      work_branch: workBranch,
      work_branch_exists: workExists,
      // 0 pendentes = tudo que está na branch já foi mesclado na main.
      in_sync: pending.length === 0,
      ahead_by: aheadBy,
      behind_by: behindBy,
      pending_commits: pending,
      main: head(mainBranch),
      main_commits: mainCommits,
      work: workExists ? head(workBranchInfo) : null,
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
