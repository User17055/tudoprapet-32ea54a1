import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";

// Leitura paginada de uma tabela inteira nas edge functions. Mesmo motivo e mesmas
// regras do `src/lib/fetchAllRows.ts` do site: o PostgREST corta a resposta em 1000
// linhas sem erro, e a service role nao muda isso.

export const ROW_PAGE_SIZE = 1000;
// 100 mil linhas. Guarda contra laco infinito se a paginacao vier quebrada.
export const ROW_MAX_PAGES = 100;

export type OrderColumn = string | { column: string; ascending?: boolean };

export interface RowsFilter {
  eq(column: string, value: unknown): RowsFilter;
  neq(column: string, value: unknown): RowsFilter;
  in(column: string, values: readonly unknown[]): RowsFilter;
  is(column: string, value: unknown): RowsFilter;
  not(column: string, operator: string, value: unknown): RowsFilter;
}

export interface FetchAllRowsOptions {
  /** A ULTIMA coluna precisa ser sem empate (a chave da tabela). */
  orderBy: OrderColumn | readonly OrderColumn[];
  pageSize?: number;
  filter?: (query: RowsFilter) => RowsFilter;
}

interface PageQuery {
  order(column: string, options: { ascending: boolean }): PageQuery;
  range(from: number, to: number): PromiseLike<{ data: unknown[] | null; error: unknown }>;
}

export async function fetchAllRows<T>(
  client: SupabaseClient,
  table: string,
  columns: string,
  { orderBy, pageSize = ROW_PAGE_SIZE, filter }: FetchAllRowsOptions,
): Promise<T[]> {
  const order = (Array.isArray(orderBy) ? orderBy : [orderBy]).map((item: OrderColumn) =>
    typeof item === "string" ? { column: item, ascending: true } : { column: item.column, ascending: item.ascending ?? true }
  );
  const rows: T[] = [];
  for (let page = 0; page < ROW_MAX_PAGES; page++) {
    const from = page * pageSize;
    const base = client.from(table).select(columns);
    let query = (filter ? filter(base as unknown as RowsFilter) : base) as unknown as PageQuery;
    for (const item of order) query = query.order(item.column, { ascending: item.ascending });
    const { data, error } = await query.range(from, from + pageSize - 1);
    // Propagar: lista curta tratada como completa e pior que falhar.
    if (error) throw error;
    const batch = (data || []) as T[];
    rows.push(...batch);
    if (batch.length < pageSize) return rows;
  }
  console.error(
    `${table}: leitura parou em ${rows.length} linhas (limite de seguranca de ${ROW_MAX_PAGES} paginas). O resultado esta incompleto.`,
  );
  return rows;
}

/** Mesmo resultado no formato `{ data, error }` do `select` antigo. */
export async function fetchAllRowsResult<T>(
  client: SupabaseClient,
  table: string,
  columns: string,
  options: FetchAllRowsOptions,
): Promise<{ data: T[] | null; error: unknown }> {
  try {
    return { data: await fetchAllRows<T>(client, table, columns, options), error: null };
  } catch (error) {
    return { data: null, error };
  }
}
