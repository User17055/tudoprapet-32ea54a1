import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// Trava contra o corte silencioso de 1000 linhas do PostgREST.
//
// Por que existe: um `select` sem paginacao devolve so as primeiras 1000 linhas, sem erro.
// O codigo funciona enquanto a tabela e pequena e quebra calado no dia em que ela cresce.
// Foi assim com product_audience (08/2026), com o catalogo (10/2026: Cachorro mostrava 56
// de 133 produtos) e com os precos de assinante no admin (1036 linhas, 36 sumiam). Cada
// vez corrigimos um caso; este teste fecha a classe.
//
// Regra: toda leitura (`.from(tabela)...select(...)`), no site e nas edge functions, precisa
// ser uma destas:
//   1. limitada na propria cadeia: .single(), .maybeSingle(), .range(), head: true, ou
//      .limit(N) com N < 1000 ("os 100 ultimos pedidos"). `.limit(1000)` ou mais e o mesmo
//      corte escrito por extenso e nao conta.
//   2. feita por `fetchAllRows` / `fetchAllRowsResult` (src/lib ou supabase/functions/_shared)
//   3. anotada logo acima com `// leitura-limitada: <por que nunca passa de 1000>`
//      Ex.: "enderecos de UM cliente", "variantes do carrinho".
// "A tabela e pequena" NAO e motivo: tabela pequena cresce.

const ROOT = join(__dirname, "..", "..");
const SCAN_DIRS = ["src", join("supabase", "functions")];
const ANNOTATION = "leitura-limitada:";
/** A anotacao vale nas 3 linhas acima do `.from(`. */
const ANNOTATION_WINDOW = 3;

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "test") files.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(entry.name) && !/(_test|\.test)\.tsx?$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

/** Troca comentarios por espaco do mesmo tamanho, para nao confundir o fim da cadeia. */
function blankComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (match, before: string) => before + " ".repeat(match.length - before.length));
}

/** Trecho da cadeia que comeca em `.from(`: vai ate o `;`, `,` ou fechamento no mesmo nivel. */
function chainFrom(source: string, start: number): string {
  let depth = 0;
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if ("([{".includes(char)) depth++;
    else if (")]}".includes(char)) {
      depth--;
      if (depth < 0) return source.slice(start, index);
    } else if ((char === ";" || char === ",") && depth === 0) {
      return source.slice(start, index);
    }
  }
  return source.slice(start);
}

function isBounded(chain: string): boolean {
  if (/\.(single|maybeSingle|range)\(|head:\s*true/.test(chain)) return true;
  const limit = chain.match(/\.limit\(\s*([^)]*?)\s*\)/);
  if (!limit) return false;
  // Limite em variavel e decisao explicita ("os N mais recentes"); so o numero escrito
  // de 1000 ou mais e o corte do PostgREST disfarcado.
  return !/^\d+$/.test(limit[1]) || Number(limit[1]) < 1000;
}

/** Leituras sem limite nem motivo anotado, com a linha (1-based) e a tabela. */
export function unboundedReadsIn(original: string): { line: number; table: string }[] {
  const source = blankComments(original);
  const lines = original.split("\n");
  const reads: { line: number; table: string }[] = [];
  for (const match of source.matchAll(/\.from\(\s*["'`]([a-z_]+)["'`]\s*(?:as\s+\w+\s*)?\)/g)) {
    const chain = chainFrom(source, match.index!);
    if (!/\.select\(/.test(chain)) continue;
    if (/\.(insert|upsert|update|delete)\(/.test(chain)) continue;
    if (isBounded(chain)) continue;
    const line = source.slice(0, match.index).split("\n").length;
    const above = lines.slice(Math.max(0, line - 1 - ANNOTATION_WINDOW), line).join("\n");
    if (above.includes(ANNOTATION)) continue;
    reads.push({ line, table: match[1] });
  }
  return reads;
}

describe("leituras do banco", () => {
  it("nenhuma lista e lida sem paginacao ou motivo anotado", () => {
    const offenders = SCAN_DIRS.flatMap((dir) => sourceFiles(join(ROOT, dir))).flatMap((file) =>
      unboundedReadsIn(readFileSync(file, "utf8")).map((read) =>
        `${relative(ROOT, file).split(sep).join("/")}:${read.line} (${read.table})`));
    // Se falhar: use fetchAllRows, limite a consulta, ou anote a linha de cima com
    // `// leitura-limitada: <motivo>`. Veja o comentario no topo deste arquivo.
    expect(offenders).toEqual([]);
  });

  it("o detector acha leitura sem limite e respeita limite e anotacao", () => {
    const sample = [
      'const a = await supabase.from("brands").select("*").order("name");',
      "// leitura-limitada: enderecos de UM cliente",
      'const b = await supabase.from("customer_addresses").select("*").eq("user_id", id);',
      'const c = await supabase.from("profiles").select("*").eq("id", id).maybeSingle();',
      'const d = await supabase.from("payments").select("*").order("created_at").limit(100);',
      'const e = await supabase.from("payments").select("*").order("created_at").limit(take);',
      'const f = await supabase.from("categories").select("*").limit(1000);',
      'const g = await supabase.from("hero_banners") // virgula, em comentario',
      '  .select("*");',
      'await supabase.from("brands").update({ name }).eq("id", id).select();',
    ].join("\n");
    expect(unboundedReadsIn(sample)).toEqual([
      { line: 1, table: "brands" },
      { line: 7, table: "categories" },
      { line: 8, table: "hero_banners" },
    ]);
  });

  it("anotacao longe demais nao vale", () => {
    const sample = [
      "// leitura-limitada: motivo de outra leitura",
      "",
      "",
      "",
      'const a = await supabase.from("brands").select("*");',
    ].join("\n");
    expect(unboundedReadsIn(sample)).toEqual([{ line: 5, table: "brands" }]);
  });
});
