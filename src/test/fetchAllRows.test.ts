import { beforeEach, describe, expect, it, vi } from "vitest";

// Banco falso: guarda cada chamada e devolve a fatia pedida no `range`, com o corte de
// 1000 linhas do PostgREST.
const calls: { table: string; ops: string[] }[] = [];
let table: { id: number; role: string }[] = [];

vi.mock("@/integrations/supabase/client", () => {
  const builder = (name: string) => {
    const record = { table: name, ops: [] as string[] };
    calls.push(record);
    let rows = [...table];
    const query = {
      select(columns: string) { record.ops.push(`select:${columns}`); return query; },
      eq(column: string, value: unknown) {
        record.ops.push(`eq:${column}=${value}`);
        rows = rows.filter((row) => row[column as keyof typeof row] === value);
        return query;
      },
      order(column: string, { ascending }: { ascending: boolean }) {
        record.ops.push(`order:${column}:${ascending ? "asc" : "desc"}`);
        return query;
      },
      range(from: number, to: number) {
        record.ops.push(`range:${from}-${to}`);
        return Promise.resolve({ data: rows.slice(from, Math.min(to + 1, from + 1000)), error: null });
      },
    };
    return query;
  };
  return { supabase: { from: builder } };
});

import { fetchAllRows, fetchAllRowsResult } from "@/lib/fetchAllRows";

beforeEach(() => {
  calls.length = 0;
  table = Array.from({ length: 2500 }, (_, index) => ({ id: index, role: index % 2 ? "admin" : "user" }));
});

describe("fetchAllRows", () => {
  it("le alem das 1000 linhas que o PostgREST devolve por vez", async () => {
    const rows = await fetchAllRows<{ id: number }>("t", "*", { orderBy: "id" });
    expect(rows).toHaveLength(2500);
    expect(calls).toHaveLength(3);
  });

  it("aplica o filtro e a ordem composta em TODAS as paginas", async () => {
    const rows = await fetchAllRows("t", "*", {
      orderBy: [{ column: "created_at", ascending: false }, "id"],
      filter: (query) => query.eq("role", "admin"),
      pageSize: 500,
    });
    expect(rows).toHaveLength(1250);
    for (const call of calls) {
      expect(call.ops).toContain("eq:role=admin");
      expect(call.ops.filter((op) => op.startsWith("order:"))).toEqual(["order:created_at:desc", "order:id:asc"]);
    }
  });

  it("formato { data, error } devolve o erro em vez de lancar", async () => {
    const failing = vi.spyOn(console, "error").mockImplementation(() => {});
    const { supabase } = await import("@/integrations/supabase/client");
    const original = supabase.from;
    (supabase as { from: unknown }).from = () => ({
      select: () => ({ order: () => ({ range: () => Promise.resolve({ data: null, error: new Error("sem permissao") }) }) }),
    });
    const result = await fetchAllRowsResult("t", "*", { orderBy: "id" });
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe("sem permissao");
    (supabase as { from: unknown }).from = original;
    failing.mockRestore();
  });
});
