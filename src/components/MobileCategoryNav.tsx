import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Grid2X2, Package } from "lucide-react";
import { ProductCard } from "@/components/ProductCard";
import type { Category } from "@/hooks/useCategoryTree";
import type { MegaMenuItem } from "@/components/MegaMenu";
import { fetchAllShopifyProducts, type ShopifyProduct } from "@/lib/shopify";
import { isProductAvailable } from "@/lib/productAvailability";
import { useClientSaleVisibility } from "@/hooks/useClientSaleVisibility";
import { useIsFranchisee } from "@/hooks/useIsFranchisee";
import { isClientProductVisible } from "@/lib/clientSaleVisibility";
import { supabase } from "@/integrations/supabase/client";

const catalogHref = (slug: string, id: string) => `/catalogo?categoria=${slug}&categoria_id=${id}`;

interface MobileCategoryNavProps {
  items: MegaMenuItem[];
  childrenOf: Map<string, Category[]>;
  isActive: (slug: string) => boolean;
  onNavigate: () => void;
  /**
   * Conteúdo fixo no rodapé do painel. O painel é um portal `fixed inset-0`
   * opaco: qualquer coisa que o Header desenhe ao lado dele fica coberta e
   * inalcançável. Quem precisa aparecer junto do menu entra por aqui.
   */
  footer?: ReactNode;
}

interface ProductCategoryLink {
  shopify_product_id: string;
  category_id: string;
}

/** Menu mobile em tela cheia com pets no topo e categorias ilustradas. */
export const MobileCategoryNav = ({ items, childrenOf, isActive, onNavigate, footer }: MobileCategoryNavProps) => {
  const initialRoot = items.find((item) => isActive(item.slug)) || items[0];
  const [selectedRootId, setSelectedRootId] = useState(initialRoot?.id || "");
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [productCategories, setProductCategories] = useState<ProductCategoryLink[]>([]);
  const { blockedVariantIds } = useClientSaleVisibility();
  const { isFranchisee } = useIsFranchisee();

  useEffect(() => {
    if (!selectedRootId && items[0]) setSelectedRootId(items[0].id);
  }, [items, selectedRootId]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    let active = true;
    Promise.all([
      fetchAllShopifyProducts(),
      supabase.from("product_categories").select("shopify_product_id, category_id"),
    ]).then(([shopifyProducts, links]) => {
      if (!active) return;
      setProducts(shopifyProducts);
      setProductCategories((links.data || []) as ProductCategoryLink[]);
    }).catch(console.error);
    return () => {
      active = false;
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const selectedRoot = items.find((item) => item.id === selectedRootId) || items[0];
  const visibleCategories = selectedRoot ? childrenOf.get(selectedRoot.id) || [] : [];
  const productById = useMemo(
    () => new Map(products.map((product) => [product.node.id, product])),
    [products],
  );

  const descendantIds = (categoryId: string) => {
    const result = new Set<string>([categoryId]);
    const pending = [categoryId];
    while (pending.length) {
      const parentId = pending.shift()!;
      for (const child of childrenOf.get(parentId) || []) {
        if (result.has(child.id)) continue;
        result.add(child.id);
        pending.push(child.id);
      }
    }
    return result;
  };

  const representativeProduct = (categoryId: string) => {
    const categoryIds = descendantIds(categoryId);
    const linkedIds = productCategories
      .filter((link) => categoryIds.has(link.category_id))
      .map((link) => link.shopify_product_id);
    return linkedIds
      .map((productId) => productById.get(productId))
      .find((product): product is ShopifyProduct => Boolean(product && isProductAvailable(product)
        && isClientProductVisible(product, blockedVariantIds, isFranchisee)));
  };

  const productsForCategory = (categoryId: string) => {
    const categoryIds = descendantIds(categoryId);
    const linkedIds = new Set(
      productCategories
        .filter((link) => categoryIds.has(link.category_id))
        .map((link) => link.shopify_product_id),
    );
    return products
      .filter((product) => linkedIds.has(product.node.id) && isProductAvailable(product)
        && isClientProductVisible(product, blockedVariantIds, isFranchisee))
      .slice(0, 10);
  };

  const categoryDescription = (category: Category) => {
    const children = childrenOf.get(category.id) || [];
    if (children.length) return children.slice(0, 5).map((child) => child.name).join(", ");
    return `Veja todos os produtos de ${category.name.toLocaleLowerCase("pt-BR")}`;
  };

  const featuredProducts = selectedCategory ? productsForCategory(selectedCategory.id) : [];
  const selectedChildren = selectedCategory ? childrenOf.get(selectedCategory.id) || [] : [];

  const handleBack = () => {
    if (selectedCategory) {
      setSelectedCategory(null);
      return;
    }
    onNavigate();
  };

  return createPortal(
    <div role="dialog" aria-label="Categorias" className="fixed inset-0 z-[100] flex flex-col bg-white lg:hidden">
      <header className="flex h-20 shrink-0 items-center justify-between border-b border-[#ededed] px-5">
        <button type="button" onClick={handleBack} className="flex h-11 w-11 items-center justify-start text-[#171717]" aria-label="Voltar">
          <ChevronLeft className="h-8 w-8" strokeWidth={2.5} />
        </button>
        <h1 className="mr-auto font-display text-xl font-black uppercase tracking-tight text-[#171717]">
          {selectedCategory?.name || "Categorias"}
        </h1>
        <Grid2X2 className="h-7 w-7 text-[#171717]" />
      </header>

      {!selectedCategory && (
        <div className="shrink-0 overflow-x-auto bg-[#f5f5f5] px-5 py-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex min-w-max gap-3">
            {items.map((item) => {
              const selected = item.id === selectedRoot?.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setSelectedRootId(item.id);
                    setSelectedCategory(null);
                  }}
                  className={`min-w-28 rounded-2xl px-5 py-3.5 text-sm font-bold transition-colors ${
                    selected ? "bg-[#1d1d1f] text-white" : "bg-white text-[#202124]"
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-8">
        {!selectedCategory && selectedRoot && visibleCategories.length === 0 && (
          <Link to={catalogHref(selectedRoot.slug, selectedRoot.id)} onClick={onNavigate} className="flex min-h-32 items-center justify-between border-b border-[#eeeeee] py-5">
            <div>
              <h2 className="text-lg font-black uppercase text-[#202124]">Ver todos</h2>
              <p className="mt-2 text-sm text-[#777]">Todos os produtos para {selectedRoot.label}</p>
            </div>
            <ChevronRight className="h-7 w-7 text-[#333]" />
          </Link>
        )}

        {!selectedCategory && visibleCategories.map((category) => {
          const product = representativeProduct(category.id);
          const image = product?.node.images.edges[0]?.node;
          const hasChildren = (childrenOf.get(category.id) || []).length > 0;
          const content = (
            <>
              <div className="min-w-0">
                <h2 className="text-[15px] font-black uppercase leading-tight text-[#202124]">{category.name}</h2>
                <p className="mt-2 line-clamp-3 text-[14px] leading-snug text-[#7a7a7a]">{categoryDescription(category)}</p>
              </div>
              <div className="flex h-24 w-[88px] items-center justify-center overflow-hidden rounded-xl bg-white">
                {image ? (
                  <img src={image.url} alt="" className="h-full w-full object-contain" loading="lazy" />
                ) : (
                  <Package className="h-8 w-8 text-[#b8b8b8]" />
                )}
              </div>
              <ChevronRight className="h-7 w-7 text-[#333]" strokeWidth={3} />
            </>
          );
          if (hasChildren) {
            return (
              <button
                key={category.id}
                type="button"
                onClick={() => setSelectedCategory(category)}
                className="grid min-h-36 w-full grid-cols-[minmax(0,1fr)_88px_24px] items-center gap-3 border-b border-[#eeeeee] py-5 text-left"
              >
                {content}
              </button>
            );
          }
          return (
            <Link
              key={category.id}
              to={catalogHref(category.slug, category.id)}
              onClick={onNavigate}
              className="grid min-h-36 grid-cols-[minmax(0,1fr)_88px_24px] items-center gap-3 border-b border-[#eeeeee] py-5"
            >
              {content}
            </Link>
          );
        })}

        {selectedCategory && (
          <>
            <nav aria-label={`Subcategorias de ${selectedCategory.name}`}>
              {selectedChildren.map((category) => (
                <Link
                  key={category.id}
                  to={catalogHref(category.slug, category.id)}
                  onClick={onNavigate}
                  className="flex min-h-24 items-center justify-between border-b border-[#eeeeee] py-5"
                >
                  <span className="text-[15px] font-black uppercase leading-tight text-[#202124]">
                    {category.name}
                  </span>
                  <ChevronRight className="h-7 w-7 shrink-0 text-[#333]" strokeWidth={3} />
                </Link>
              ))}
              <Link
                to={catalogHref(selectedCategory.slug, selectedCategory.id)}
                onClick={onNavigate}
                className="flex min-h-24 items-center justify-between border-b border-[#eeeeee] py-5"
              >
                <span className="text-[15px] font-black uppercase leading-tight text-[#202124]">Ver todos</span>
                <ChevronRight className="h-7 w-7 shrink-0 text-[#333]" strokeWidth={3} />
              </Link>
            </nav>

            {featuredProducts.length > 0 && (
              <section className="pt-7">
                <h2 className="mb-5 text-xl font-black leading-tight text-[#202124]">
                  Mais comprados em {selectedCategory.name}
                </h2>
                <div className="-mx-5 flex gap-4 overflow-x-auto px-5 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {featuredProducts.map((product) => (
                    <div key={product.node.id} className="w-[44vw] max-w-44 shrink-0">
                      <ProductCard
                        product={product}
                        products={products}
                        compact
                        hideVariations
                      />
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>

      {footer && (
        <footer className="shrink-0 border-t border-[#ededed] bg-white px-5 py-4">
          {footer}
        </footer>
      )}
    </div>,
    document.body,
  );
};
