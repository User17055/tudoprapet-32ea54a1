const KEY = "d63d3cb8b590986ac745738747dbda47";
const eps: Record<string,Record<string,string>> = {
  "info.php": {},
  "pedidos.pesquisa.php": { dataInicial: "01/09/2026", dataFinal: "25/09/2026" },
  "contas.receber.pesquisa.php": { data_ini_vencimento: "01/09/2026", data_fim_vencimento: "30/10/2026" },
  "notas.fiscais.pesquisa.php": { dataInicial: "01/09/2026", dataFinal: "25/09/2026" },
  "formas.pagamento.pesquisa.php": {},
  "naturezas.operacao.pesquisa.php": {},
};
Deno.serve(async (req) => {
  if (new URL(req.url).searchParams.get("k") !== KEY) return new Response("no", { status: 404 });
  const token = Deno.env.get("OLIST_API_TOKEN") || "";
  const out: Record<string, unknown> = {};
  for (const [ep, f] of Object.entries(eps)) {
    try {
      const r = await fetch("https://api.tiny.com.br/api2/" + ep, { method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token, formato: "JSON", ...f }) });
      const j = await r.json().catch(() => null);
      const ret = j?.retorno ?? {};
      const summary: Record<string, unknown> = { http: r.status, status: ret.status, codigo_erro: ret.codigo_erro, erros: ret.erros };
      if (ep === "info.php") { const c = ret.conta ?? {}; summary.regime = c.regime_tributario; summary.uf = c.uf; summary.keys = Object.keys(c); }
      if (ep === "notas.fiscais.pesquisa.php") summary.series = [...new Set((ret.notas_fiscais ?? []).map((n: any) => n?.nota_fiscal?.serie))]; 
      if (ep === "notas.fiscais.pesquisa.php") summary.situacoes = [...new Set((ret.notas_fiscais ?? []).map((n: any) => n?.nota_fiscal?.situacao))];
      if (ep === "formas.pagamento.pesquisa.php") summary.formas = (ret.formas_pagamento ?? ret.formas ?? []).map((x: any) => JSON.stringify(x).slice(0,80));
      if (ep === "naturezas.operacao.pesquisa.php") summary.naturezas = (ret.naturezas_operacao ?? ret.naturezas ?? []).map((x: any) => JSON.stringify(x).slice(0,80));
      summary.count = ret.numero_paginas;
      out[ep] = summary;
    } catch (e) { out[ep] = String(e); }
  }
  return Response.json(out);
});
