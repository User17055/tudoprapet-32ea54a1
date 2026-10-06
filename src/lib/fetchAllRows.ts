import { supabase } from "@/integrations/supabase/client";

// Leitura paginada de uma tabela inteira.
//
// Por que isto existe: o PostgREST corta a resposta (1000 linhas por padrao no
// Supabase) e um `select()` sem paginacao devolve so a primeira pagina, sem erro
// e sem aviso. Foi o que tirou produtos da loja em 19/08/2026 (product_audience)
// e o que estava para acontecer com as tabelas de preco.
//
// A correcao daquela vez ficou em um unico ponto compartilhado de proposito --
// eram tres copias do mesmo select, e corrigir uma so deixaria as outras
// apodrecendo. Este helper e o mesmo raciocinio um nivel acima: um lugar so, em
// vez de uma copia da paginacao por tabela.

export const ROW_PAGE_SIZE = 1000;
// 100 mil linhas. Guarda contra laco infinito se a paginacao vier quebrada.
export const ROW_MAX_PAGES = 100;

/** Coluna de ordenacao; `ascending` padrao e true. */
export type OrderColumn = string | { column: string; ascending?: boolean };

/** Filtros aceitos antes da paginacao (os que o codigo usa hoje). */
export interface RowsFilter {
  eq(column: string, value: unknown): RowsFilter;
  neq(column: string, value: unknown): RowsFilter;
  in(column: string, values: readonly unknown[]): RowsFilter;
  is(column: string, value: unknown): RowsFilter;
  not(column: string, operator: string, value: unknown): RowsFilter;
}

export interface FetchAllRowsOptions {
  /**
   * Ordenacao. A ULTIMA coluna precisa ser ESTAVEL e sem empate -- tipicamente a
   * chave da tabela. Sem ordem definida, o Postgres pode devolver ordens
   * diferentes entre paginas e o `range` repete ou pula linha; a linha pulada
   * some do resultado exatamente como no bug original. Para manter a ordem de uma
   * tela (por nome, por data), passe essa coluna antes: `["name", "id"]`.
   */
  orderBy: OrderColumn | readonly OrderColumn[];
  /** Vale para `orderBy` simples em string; mantido pelos chamadores antigos. */
  ascending?: boolean;
  pageSize?: number;
  /** Filtro aplicado em todas as paginas, ex.: `(q) => q.eq("role", "admin")`. */
  filter?: (query: RowsFilter) => RowsFilter;
}

export async function fetchAllRows<T>(
  table: string,
  columns: string,
  { orderBy, ascending = true, pageSize = ROW_PAGE_SIZE, filter }: FetchAllRowsOptions,
): Promise<T[]> {
  const order = (Array.isArray(orderBy) ? orderBy : [orderBy]).map((item: OrderColumn) =>
    typeof item === "string" ? { column: item, ascending } : { column: item.column, ascending: item.ascending ?? true });
  const rows: T[] = [];
  for (let page = 0; page < ROW_MAX_PAGES; page++) {
    const from = page * pageSize;
    const base = supabase.from(table as never).select(columns);
    let query = (filter ? filter(base as unknown as RowsFilter) : base) as unknown as typeof base;
    for (const item of order) query = query.order(item.column, { ascending: item.ascending });
    const { data, error } = await query.range(from, from + pageSize - 1);
    // Propagar. Devolver lista curta seria pior que falhar: o chamador trataria
    // o resultado incompleto como completo.
    if (error) throw error;
    const lote = (data || []) as T[];
    rows.push(...lote);
    if (lote.length < pageSize) return rows;
  }
  // Truncar de novo aqui repetiria o bug original, entao pelo menos nao e em
  // silencio.
  console.error(
    `${table}: leitura parou em ${rows.length} linhas (limite de seguranca de ${ROW_MAX_PAGES} paginas). O resultado esta incompleto.`,
  );
  return rows;
}

/**
 * Mesma leitura, no formato `{ data, error }` do Supabase: troca um `select` antigo sem
 * mexer em quem le `.data` e `.error` depois.
 */
export async function fetchAllRowsResult<T = unknown>(
  table: string,
  columns: string,
  options: FetchAllRowsOptions,
): Promise<{ data: T[] | null; error: Error | null }> {
  try {
    return { data: await fetchAllRows<T>(table, columns, options), error: null };
  } catch (error) {
    return { data: null, error: error as Error };
  }
}
