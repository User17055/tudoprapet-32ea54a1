import { fetchAllRows } from "@/lib/fetchAllRows";

// Leituras compartilhadas pela vitrine (catalogo, menu desktop e menu mobile).
//
// Por que isto existe: as tres telas faziam `select()` sem paginacao nas tabelas
// de vinculo. Em 10/2026 `product_categories` tinha 1975 linhas e
// `product_attributes` 4283 -- o PostgREST devolvia so as primeiras 1000, sem
// ordem definida. Categorias inteiras (Higiene, Tapetes, Areias) sumiam do menu
// e os filtros mostravam metade dos produtos. Um lugar so, pelo mesmo motivo do
// `fetchAllRows`: corrigir uma copia deixaria as outras apodrecendo.

export interface StoreCategory {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  sort_order: number;
}

export interface ProductCategoryRow { shopify_product_id: string; category_id: string; }
export interface ProductBrandRow { shopify_product_id: string; brand_id: string | null; }
export interface ProductAttributeRow { shopify_product_id: string; attr_key: string; attr_value: string; }
export interface StoreBrand { id: string; name: string; slug: string; }

// Curto de proposito: o admin edita essas tabelas e quem abre a loja na mesma
// aba precisa ver a mudanca sem recarregar a pagina inteira.
const CATALOG_DATA_TTL = 60 * 1000;

const cache = new Map<string, { expiresAt: number; promise: Promise<unknown> }>();

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.promise as Promise<T>;
  const promise = load();
  cache.set(key, { expiresAt: Date.now() + CATALOG_DATA_TTL, promise });
  // Falha nao fica no cache: a proxima tela tenta de novo.
  promise.catch(() => {
    if (cache.get(key)?.promise === promise) cache.delete(key);
  });
  return promise;
}

export function clearCatalogDataCache() {
  cache.clear();
}

export const fetchStoreCategories = () =>
  cached("categories", () =>
    fetchAllRows<StoreCategory>("categories", "id, name, slug, parent_id, sort_order", {
      orderBy: ["sort_order", "name", "id"],
    }));

export const fetchStoreBrands = () =>
  cached("brands", () =>
    fetchAllRows<StoreBrand>("brands", "id, name, slug", { orderBy: ["name", "id"] }));

export const fetchProductCategoryRows = () =>
  cached("product_categories", () =>
    fetchAllRows<ProductCategoryRow>("product_categories", "id,shopify_product_id,category_id", { orderBy: "id" }));

export const fetchProductBrandRows = () =>
  cached("product_content", () =>
    fetchAllRows<ProductBrandRow>("product_content", "id,shopify_product_id,brand_id", { orderBy: "id" }));

export const fetchProductAttributeRows = () =>
  cached("product_attributes", () =>
    fetchAllRows<ProductAttributeRow>("product_attributes", "id,shopify_product_id,attr_key,attr_value", { orderBy: "id" }));
