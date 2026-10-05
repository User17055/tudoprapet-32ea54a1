// Regras dos filtros do catalogo, fora do componente para poderem ser testadas.
//
// Tudo que o cliente escolhe vive na URL (`/catalogo?categoria=...&marca=...`):
// recarregar, voltar de um produto ou compartilhar o link devolve exatamente o
// mesmo resultado. Antes marca, preco e atributos ficavam so no estado do React
// e se perdiam em qualquer navegacao.

export interface PriceRange { key: string; label: string; min: number; max: number; }

// Intervalos semiabertos [min, max): um produto de R$ 25,00 cai em uma faixa so.
// Com `<=` nas duas pontas ele era contado (e listado) em duas.
export const PRICE_RANGES: readonly PriceRange[] = [
  { key: "0-25", label: "Até R$ 24,99", min: 0, max: 25 },
  { key: "25-50", label: "R$ 25,00 a R$ 49,99", min: 25, max: 50 },
  { key: "50-100", label: "R$ 50,00 a R$ 99,99", min: 50, max: 100 },
  { key: "100-200", label: "R$ 100,00 a R$ 199,99", min: 100, max: 200 },
  { key: "200+", label: "R$ 200,00 ou mais", min: 200, max: Infinity },
];

export const priceInRange = (price: number, range: PriceRange) => price >= range.min && price < range.max;

export const SORT_KEYS = ["relevance", "price-asc", "price-desc", "name-asc", "name-desc"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

// Atributo "Pet" e respondido pela arvore de categorias (Cachorro/Gato); como
// filtro proprio ele duplicaria a escolha e podia contradize-la.
export const HIDDEN_ATTR_KEYS = new Set(["Pet"]);

const ATTR_PARAM_PREFIX = "f.";

export interface CatalogFilterState {
  search: string;
  categorySlug: string | null;
  categoryId: string | null;
  brandSlugs: Set<string>;
  priceKeys: Set<string>;
  attrs: Record<string, Set<string>>;
  sort: SortKey;
  page: number;
}

export function parseCatalogParams(params: URLSearchParams): CatalogFilterState {
  const attrs: Record<string, Set<string>> = {};
  for (const [name, value] of params.entries()) {
    if (!name.startsWith(ATTR_PARAM_PREFIX) || !value) continue;
    const key = name.slice(ATTR_PARAM_PREFIX.length);
    if (!key || HIDDEN_ATTR_KEYS.has(key)) continue;
    (attrs[key] ||= new Set()).add(value);
  }
  const validPrices = new Set(PRICE_RANGES.map((range) => range.key));
  const sort = params.get("ordem");
  const page = Number.parseInt(params.get("pagina") || "", 10);
  return {
    search: params.get("busca")?.trim() || "",
    // `pet` e o formato antigo de link; vira o slug da categoria.
    categorySlug: params.get("categoria") || params.get("pet") || null,
    categoryId: params.get("categoria_id") || null,
    brandSlugs: new Set(params.getAll("marca").filter(Boolean)),
    priceKeys: new Set(params.getAll("preco").filter((key) => validPrices.has(key))),
    attrs,
    sort: (SORT_KEYS as readonly string[]).includes(sort || "") ? (sort as SortKey) : "relevance",
    page: Number.isFinite(page) && page > 1 ? page : 1,
  };
}

export function buildCatalogParams(state: CatalogFilterState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.search) params.set("busca", state.search);
  if (state.categorySlug) params.set("categoria", state.categorySlug);
  if (state.categoryId) params.set("categoria_id", state.categoryId);
  for (const slug of [...state.brandSlugs].sort()) params.append("marca", slug);
  for (const range of PRICE_RANGES) if (state.priceKeys.has(range.key)) params.append("preco", range.key);
  for (const key of Object.keys(state.attrs).sort()) {
    for (const value of [...state.attrs[key]].sort()) params.append(`${ATTR_PARAM_PREFIX}${key}`, value);
  }
  if (state.sort !== "relevance") params.set("ordem", state.sort);
  if (state.page > 1) params.set("pagina", String(state.page));
  return params;
}

export const catalogCategoryHref = (category: { slug: string; id: string }) =>
  `/catalogo?categoria=${encodeURIComponent(category.slug)}&categoria_id=${encodeURIComponent(category.id)}`;

// ---------------------------------------------------------------------------
// Arvore de categorias

export interface TreeCategory { id: string; slug: string; name: string; parent_id: string | null; }

export interface CategoryIndex<T extends TreeCategory> {
  byId: Map<string, T>;
  childrenOf: Map<string | null, T[]>;
}

export function buildCategoryIndex<T extends TreeCategory>(categories: readonly T[]): CategoryIndex<T> {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const childrenOf = new Map<string | null, T[]>();
  for (const category of categories) {
    // Mae apagada: trata como raiz em vez de sumir com o ramo.
    const parent = category.parent_id && byId.has(category.parent_id) ? category.parent_id : null;
    if (!childrenOf.has(parent)) childrenOf.set(parent, []);
    childrenOf.get(parent)!.push(category);
  }
  return { byId, childrenOf };
}

/** Caminho da raiz ate a categoria, inclusive. */
export function categoryPath<T extends TreeCategory>(index: CategoryIndex<T>, id: string): T[] {
  const path: T[] = [];
  const seen = new Set<string>();
  let current = index.byId.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = current.parent_id ? index.byId.get(current.parent_id) : undefined;
  }
  return path;
}

export function categoryDescendants<T extends TreeCategory>(index: CategoryIndex<T>, rootId: string): Set<string> {
  const ids = new Set([rootId]);
  const pending = [rootId];
  while (pending.length) {
    for (const child of index.childrenOf.get(pending.pop()!) || []) {
      if (ids.has(child.id)) continue;
      ids.add(child.id);
      pending.push(child.id);
    }
  }
  return ids;
}

/**
 * Acha a categoria pedida na URL. O ID manda; sem ele, o slug -- mas ha slugs
 * repetidos entre os pets (`racao`, `farmacia`, `saches`...), entao a raiz tem
 * preferencia e, entre irmas de pets diferentes, vale a primeira pela ordem do
 * admin. Links internos sempre levam o ID; isto cobre banners e links antigos.
 */
export function resolveCategory<T extends TreeCategory>(
  categories: readonly T[],
  slug: string | null,
  id: string | null,
): T | undefined {
  if (id) {
    const byId = categories.find((category) => category.id === id);
    if (byId) return byId;
  }
  if (!slug) return undefined;
  const wanted = normalizeSlug(slug);
  const matches = categories.filter((category) =>
    normalizeSlug(category.slug) === wanted || normalizeSlug(category.name) === wanted);
  return matches.find((category) => !category.parent_id) || matches[0];
}

export const normalizeSlug = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// ---------------------------------------------------------------------------
// Facetas

export interface FacetProduct {
  id: string;
  price: number;
  brandId: string | null;
  categoryIds: ReadonlySet<string>;
  attrs: ReadonlyMap<string, ReadonlySet<string>>;
}

export interface FacetSelection {
  /** Categoria escolhida ja expandida com as descendentes; null = sem filtro. */
  categoryIds: ReadonlySet<string> | null;
  brandIds: ReadonlySet<string>;
  priceKeys: ReadonlySet<string>;
  attrs: Readonly<Record<string, ReadonlySet<string>>>;
}

export interface FacetResult {
  matchingIds: Set<string>;
  /** Produtos por categoria, somando as descendentes (cada produto conta uma vez). */
  categoryCounts: Map<string, number>;
  brandCounts: Map<string, number>;
  priceCounts: Map<string, number>;
  attrCounts: Map<string, Map<string, number>>;
}

const increment = <K,>(map: Map<K, number>, key: K) => map.set(key, (map.get(key) || 0) + 1);

/**
 * Filtra e conta no mesmo passo. Cada grupo e contado sobre os produtos que
 * passam por TODOS os outros grupos: dentro de "Cachorro", a marca mostra
 * quantos produtos de cachorro ela tem, e uma marca so de gato nao aparece.
 * Dentro do mesmo grupo as opcoes somam (OU); entre grupos, restringem (E).
 */
export function computeCatalogFacets(
  products: readonly FacetProduct[],
  selection: FacetSelection,
  parentOf: ReadonlyMap<string, string | null>,
): FacetResult {
  const result: FacetResult = {
    matchingIds: new Set(),
    categoryCounts: new Map(),
    brandCounts: new Map(),
    priceCounts: new Map(),
    attrCounts: new Map(),
  };
  const attrEntries = Object.entries(selection.attrs).filter(([, values]) => values.size > 0);

  for (const product of products) {
    const passCategory = !selection.categoryIds
      || [...product.categoryIds].some((id) => selection.categoryIds!.has(id));
    const passBrand = selection.brandIds.size === 0
      || (product.brandId !== null && selection.brandIds.has(product.brandId));
    const productRanges = PRICE_RANGES.filter((range) => priceInRange(product.price, range));
    const passPrice = selection.priceKeys.size === 0
      || productRanges.some((range) => selection.priceKeys.has(range.key));
    const failedAttrs = attrEntries.filter(([key, values]) =>
      ![...(product.attrs.get(key) || [])].some((value) => values.has(value)));
    const passAttrs = failedAttrs.length === 0;

    if (passCategory && passBrand && passPrice && passAttrs) result.matchingIds.add(product.id);

    if (passBrand && passPrice && passAttrs) {
      const counted = new Set<string>();
      for (const id of product.categoryIds) {
        let current: string | null | undefined = id;
        while (current && !counted.has(current)) {
          counted.add(current);
          current = parentOf.get(current);
        }
      }
      counted.forEach((id) => increment(result.categoryCounts, id));
    }
    if (passCategory && passPrice && passAttrs && product.brandId) increment(result.brandCounts, product.brandId);
    if (passCategory && passBrand && passAttrs) productRanges.forEach((range) => increment(result.priceCounts, range.key));
    if (passCategory && passBrand && passPrice) {
      // Um atributo reprovado so libera a contagem do proprio grupo.
      for (const [key, values] of product.attrs) {
        if (HIDDEN_ATTR_KEYS.has(key)) continue;
        if (failedAttrs.length > 1 || (failedAttrs.length === 1 && failedAttrs[0][0] !== key)) continue;
        if (!result.attrCounts.has(key)) result.attrCounts.set(key, new Map());
        values.forEach((value) => increment(result.attrCounts.get(key)!, value));
      }
    }
  }
  return result;
}
