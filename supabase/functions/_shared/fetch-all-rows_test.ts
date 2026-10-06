import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { fetchAllRows, fetchAllRowsResult } from "./fetch-all-rows.ts";

// Cliente falso que corta em 1000 linhas como o PostgREST e registra o que foi pedido.
function fakeClient(rows: { id: number; kind: string }[], fail = false) {
  const calls: string[][] = [];
  const client = {
    from: () => {
      const ops: string[] = [];
      calls.push(ops);
      let data = [...rows];
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          ops.push(`eq:${column}=${value}`);
          data = data.filter((row) => row[column as keyof typeof row] === value);
          return query;
        },
        order: (column: string, { ascending }: { ascending: boolean }) => {
          ops.push(`order:${column}:${ascending ? "asc" : "desc"}`);
          return query;
        },
        range: (from: number, to: number) =>
          Promise.resolve(fail
            ? { data: null, error: new Error("falhou") }
            : { data: data.slice(from, Math.min(to + 1, from + 1000)), error: null }),
      };
      return query;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const rows = Array.from({ length: 2300 }, (_, id) => ({ id, kind: id % 2 ? "a" : "b" }));

Deno.test("le alem das 1000 linhas", async () => {
  const { client, calls } = fakeClient(rows);
  const result = await fetchAllRows(client, "t", "*", { orderBy: "id" });
  assertEquals(result.length, 2300);
  assertEquals(calls.length, 3);
});

Deno.test("filtro e ordem composta valem em todas as paginas", async () => {
  const { client, calls } = fakeClient(rows);
  const result = await fetchAllRows(client, "t", "*", {
    orderBy: [{ column: "updated_at", ascending: false }, "id"],
    filter: (query) => query.eq("kind", "a"),
    pageSize: 400,
  });
  assertEquals(result.length, 1150);
  for (const ops of calls) {
    assertEquals(ops, ["eq:kind=a", "order:updated_at:desc", "order:id:asc"]);
  }
});

Deno.test("formato { data, error } devolve o erro", async () => {
  const { client } = fakeClient(rows, true);
  const result = await fetchAllRowsResult(client, "t", "*", { orderBy: "id" });
  assertEquals(result.data, null);
  assertEquals((result.error as Error).message, "falhou");
});
