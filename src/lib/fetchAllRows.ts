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

export interface FetchAllRowsOptions {
  /**
   * Coluna de ordenacao. Precisa ser ESTAVEL e sem empate -- tipicamente a chave
   * natural da tabela. Sem ordem definida, o Postgres pode devolver ordens
   * diferentes entre paginas e o `range` repete ou pula linha; a linha pulada
   * some do resultado exatamente como no bug original.
   */
  orderBy: string;
  ascending?: boolean;
  pageSize?: number;
}

export async function fetchAllRows<T>(
  table: string,
  columns: string,
  { orderBy, ascending = true, pageSize = ROW_PAGE_SIZE }: FetchAllRowsOptions,
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < ROW_MAX_PAGES; page++) {
    const from = page * pageSize;
    const { data, error } = await supabase
      .from(table as never)
      .select(columns)
      .order(orderBy, { ascending })
      .range(from, from + pageSize - 1);
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
