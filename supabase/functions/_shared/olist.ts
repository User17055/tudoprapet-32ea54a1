export const OLIST_PRODUCTS_SEARCH_URL = "https://api.tiny.com.br/api2/produtos.pesquisa.php";

export interface OlistCost {
  id: string;
  sku: string;
  name: string;
  cost: number;
}

type OlistProduct = {
  id?: string | number;
  codigo?: string | number;
  nome?: string;
  preco_custo?: string | number;
};

type OlistSearchResponse = {
  retorno?: {
    status?: string;
    codigo_erro?: number;
    erros?: Array<{ erro?: string }>;
    produtos?: Array<{ produto?: OlistProduct }>;
  };
};

export function normalizeSku(value: unknown): string {
  return String(value ?? "").trim().toLocaleUpperCase("pt-BR");
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function findExactOlistCost(payload: OlistSearchResponse, requestedSku: string): OlistCost | null {
  const sku = normalizeSku(requestedSku);
  const products = payload.retorno?.produtos ?? [];
  const product = products
    .map((entry) => entry.produto)
    .find((candidate) => normalizeSku(candidate?.codigo) === sku);
  if (!product) return null;

  const cost = Number(product.preco_custo);
  if (!Number.isFinite(cost) || cost <= 0) return null;
  return {
    id: String(product.id ?? ""),
    sku: String(product.codigo ?? "").trim(),
    name: String(product.nome ?? "").trim(),
    cost: roundMoney(cost),
  };
}

export async function fetchOlistCostBySku(sku: string, token: string): Promise<OlistCost | null> {
  const body = new URLSearchParams({ token, pesquisa: sku.trim(), formato: "JSON" });
  const response = await fetch(OLIST_PRODUCTS_SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body,
  });
  if (!response.ok) throw new Error(`Olist respondeu HTTP ${response.status}`);

  const payload = await response.json() as OlistSearchResponse;
  if (payload.retorno?.status === "Erro") {
    // A API usa o erro 20 tambem quando a pesquisa simplesmente nao encontra o SKU.
    if (payload.retorno.codigo_erro === 20) return null;
    const detail = payload.retorno.erros?.map((entry) => entry.erro).filter(Boolean).join("; ");
    throw new Error(detail || "A Olist recusou a consulta");
  }
  return findExactOlistCost(payload, sku);
}
