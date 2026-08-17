import { auth, defineMcp } from "@lovable.dev/mcp-js";
import getMyProfileTool from "./tools/get-my-profile";
import listMyOrdersTool from "./tools/list-my-orders";
import getMyCartTool from "./tools/get-my-cart";
import listCategoriesTool from "./tools/list-categories";

// O issuer precisa ser o host direto do Supabase, montado a partir do project
// ref (o SUPABASE_URL pode ser o proxy do Lovable Cloud e o token seria rejeitado).
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "tudoprapet",
  title: "TudoPraPet",
  version: "0.1.0",
  instructions:
    "Ferramentas da loja TudoPraPet. Use `get_my_profile` para os dados da conta conectada, " +
    "`list_my_orders` para as compras recentes, `get_my_cart` para o carrinho salvo e " +
    "`list_categories` para navegar pelas categorias do catálogo.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [getMyProfileTool, listMyOrdersTool, getMyCartTool, listCategoriesTool],
});
