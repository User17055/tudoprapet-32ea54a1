import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "get_my_cart",
  title: "Meu carrinho",
  description: "Mostra os itens salvos no carrinho da conta TudoPraPet do usuário conectado.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Não autenticado." }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("user_carts")
      .select("items,updated_at")
      .eq("user_id", ctx.getUserId())
      .maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const items = Array.isArray(data?.items) ? data?.items : [];
    return {
      content: [{
        type: "text",
        text: items.length ? JSON.stringify(items) : "O carrinho desta conta está vazio.",
      }],
      structuredContent: { items, updatedAt: data?.updated_at ?? null },
    };
  },
});
