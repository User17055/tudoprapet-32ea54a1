// Comparação do site com o retrato da Olist (tela Valores). Só leitura: as
// diferenças aparecem para o admin decidir; nada aqui grava na Olist.

export interface OlistProduct {
  id: string;
  sku: string;
  skuKey: string;
  name: string;
  price: number | null;
  promoPrice: number | null;
  cost: number | null;
  status: string | null;
  fetchedAt: string;
}

export interface OlistPriceList {
  id: string;
  name: string;
  adjustmentPercent: number;
}

export interface OlistListException {
  listId: string;
  productId: string;
  price: number | null;
  promoPrice: number | null;
}

export interface OlistRun {
  id: string;
  kind: "catalog" | "apply";
  status: "running" | "done" | "failed";
  startedAt: string;
  finishedAt: string | null;
  products: number;
  priceLists: number;
  exceptions: number;
  applied: number;
  changed: number;
  notFound: number;
  failed: number;
  error: string | null;
}

/** Mesma chave do servidor (normalizeSku): sem espaços nas pontas e em maiúsculas. */
export const olistSkuKey = (sku: string | null | undefined) => String(sku ?? "").trim().toLocaleUpperCase("pt-BR");

/** Preço que a Olist cobra na venda: o promocional quando existe. */
export const olistSalePrice = (product: Pick<OlistProduct, "price" | "promoPrice"> | null | undefined) =>
  product ? product.promoPrice ?? product.price : null;

/**
 * Preço efetivo de uma lista da Olist para um produto: a exceção do produto
 * (promocional, quando houver); sem exceção, o preço de venda com o
 * acréscimo/desconto da lista. Conferido em 26/11/2026 contra
 * `produtos.pesquisa` com `idListaPreco` (100 de 100 iguais nas duas listas).
 */
export function olistListPrice(
  list: OlistPriceList,
  product: OlistProduct | null | undefined,
  exception: OlistListException | null | undefined,
): number | null {
  if (exception) return exception.promoPrice ?? exception.price;
  if (!product) return null;
  const sale = olistSalePrice(product);
  if (sale === null) return null;
  return Math.round(sale * (1 + list.adjustmentPercent / 100) * 100) / 100;
}

export type ListRole = "franchise" | "subscriber";

const normalized = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");

/** Qual lista da Olist corresponde a qual preço do site (pelo nome). */
export function listRole(list: OlistPriceList): ListRole | null {
  const name = normalized(list.name);
  if (/franq/.test(name)) return "franchise";
  if (/plano|clube|assinante/.test(name)) return "subscriber";
  return null;
}

export const samePrice = (a: number | null | undefined, b: number | null | undefined) =>
  a !== null && a !== undefined && b !== null && b !== undefined && Math.abs(a - b) < 0.005;

export const differentPrice = (a: number | null | undefined, b: number | null | undefined) =>
  a !== null && a !== undefined && b !== null && b !== undefined && Math.abs(a - b) >= 0.005;

export type OlistFilter =
  | "all"
  | "cost_diff"
  | "sale_diff"
  | "franchise_list_diff"
  | "subscriber_list_diff"
  | "not_in_olist"
  | "olist_no_cost"
  | "no_sku";

export interface RowComparison {
  hasSku: boolean;
  olist: OlistProduct | null;
  siteCost: number | null;
  siteSale: number | null;
  siteFranchise: number | null;
  siteSubscriber: number | null;
  franchiseList: number | null;
  subscriberList: number | null;
}

export function matchesOlistFilter(row: RowComparison, filter: OlistFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "no_sku":
      return !row.hasSku;
    case "not_in_olist":
      return row.hasSku && row.olist === null;
    case "olist_no_cost":
      return row.olist !== null && row.olist.cost === null;
    case "cost_diff":
      return row.olist?.cost != null && (row.siteCost === null || differentPrice(row.siteCost, row.olist.cost));
    case "sale_diff":
      return differentPrice(row.siteSale, olistSalePrice(row.olist));
    case "franchise_list_diff":
      return differentPrice(row.siteFranchise, row.franchiseList);
    case "subscriber_list_diff":
      return differentPrice(row.siteSubscriber, row.subscriberList);
  }
}

/** Nunca conferido ou conferido há mais de `days` dias. */
export function isStale(checkedAt: string | null | undefined, days: number, now = Date.now()): boolean {
  if (!checkedAt) return true;
  const time = Date.parse(checkedAt);
  return !Number.isFinite(time) || time < now - days * 86_400_000;
}

/** Algum valor mudou de verdade a partir de `since` (AAAA-MM-DD, horário local). */
export function changedSince(dates: Array<string | null | undefined>, since: string): boolean {
  const start = new Date(`${since}T00:00:00`).getTime();
  if (!Number.isFinite(start)) return true;
  return dates.some((date) => date && Date.parse(date) >= start);
}

/** Retrato com mais de 12 h pede nova leitura antes de aplicar. */
export const SNAPSHOT_MAX_AGE_HOURS = 12;

export function snapshotAgeHours(fetchedAt: string | null | undefined, now = Date.now()): number | null {
  if (!fetchedAt) return null;
  const time = Date.parse(fetchedAt);
  return Number.isFinite(time) ? (now - time) / 3_600_000 : null;
}

export const shortDate = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : null;

export const shortDateTime = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : null;

/** Ids de categoria e de todas as subcategorias abaixo dela. */
export function categoryWithDescendants(
  categoryId: string,
  categories: Array<{ id: string; parent_id: string | null }>,
): Set<string> {
  const children = new Map<string, string[]>();
  for (const category of categories) {
    if (!category.parent_id) continue;
    children.set(category.parent_id, [...(children.get(category.parent_id) ?? []), category.id]);
  }
  const result = new Set<string>();
  const stack = [categoryId];
  while (stack.length) {
    const id = stack.pop()!;
    if (result.has(id)) continue;
    result.add(id);
    stack.push(...(children.get(id) ?? []));
  }
  return result;
}
