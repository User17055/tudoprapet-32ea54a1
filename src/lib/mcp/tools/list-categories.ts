import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_categories",
  title: "Categorias da loja",
  description: "Lista as categorias publicadas da loja TudoPraPet, opcionalmente filtrando por nome.",
  inputSchema: {
    search: z.string().optional().describe("Texto para filtrar categorias pelo nome."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ search }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Não autenticado." }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("categories")
      .select("id,name,slug,parent_id,sort_order")
      .order("sort_order", { ascending: true })
      .limit(200);
    const term = search?.trim();
    if (term) query = query.ilike("name", `%${term}%`);
    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const categories = data ?? [];
    return {
      content: [{
        type: "text",
        text: categories.length ? JSON.stringify(categories) : "Nenhuma categoria encontrada.",
      }],
      structuredContent: { categories },
    };
  },
});
