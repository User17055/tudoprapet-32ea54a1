import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_my_orders",
  title: "Meus pedidos",
  description: "Lista as compras mais recentes do usuário conectado na loja TudoPraPet, com status e total.",
  inputSchema: {
    limit: z.number().int().optional().describe("Quantidade de pedidos a retornar (1 a 25, padrão 10)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Não autenticado." }], isError: true };
    }
    const take = Math.min(Math.max(Math.trunc(limit ?? 10), 1), 25);
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("checkout_sessions")
      .select("id,status,subtotal,discount,shipping_amount,total,currency,shipping_method,shopify_order_id,created_at")
      .eq("user_id", ctx.getUserId())
      .order("created_at", { ascending: false })
      .limit(take);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const orders = data ?? [];
    return {
      content: [{
        type: "text",
        text: orders.length ? JSON.stringify(orders) : "Nenhum pedido encontrado nesta conta.",
      }],
      structuredContent: { orders },
    };
  },
});
