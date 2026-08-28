import { useEffect, useMemo, useState } from "react";
import { Boxes, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ProductPicker } from "@/components/admin/ProductPicker";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllShopifyProducts, type ShopifyProduct } from "@/lib/shopify";
import { normalizeText } from "@/lib/fuzzySearch";
import { productVariationSimilarity } from "@/lib/productVariationSuggestions";
import {
  invalidateProductVariationsCache,
  type ProductVariationItem,
} from "@/hooks/useProductVariations";

interface VariationGroup {
  id: string;
  name: string;
  created_at: string;
}

interface PendingItem {
  shopify_product_id: string;
  shopify_product_handle: string;
  shopify_product_title: string;
  label: string;
}

function suggestLabel(title: string) {
  const matches = title.match(/\d+(?:[.,]\d+)?\s*(?:kg|g|mg|ml|l|un(?:id(?:ade)?s?)?)/gi);
  return matches?.at(-1)?.replace(/\s+/g, " ") || "";
}

export default function VariationsTab() {
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [groups, setGroups] = useState<VariationGroup[]>([]);
  const [items, setItems] = useState<ProductVariationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [productId, setProductId] = useState("");
  const [label, setLabel] = useState("");
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [groupFilter, setGroupFilter] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [shop, groupRows, itemRows] = await Promise.all([
        fetchAllShopifyProducts(),
        supabase.from("product_variation_groups").select("*").order("created_at", { ascending: false }),
        supabase.from("product_variation_items").select("*").order("sort_order"),
      ]);
      if (groupRows.error) throw groupRows.error;
      if (itemRows.error) throw itemRows.error;
      setProducts(shop);
      setGroups((groupRows.data || []) as VariationGroup[]);
      setItems((itemRows.data || []) as ProductVariationItem[]);
    } catch (error) {
      toast.error("Erro ao carregar grupos de variações");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const unavailableIds = useMemo(
    () => new Set([
      ...items.map((item) => item.shopify_product_id),
      ...pending.map((item) => item.shopify_product_id),
    ]),
    [items, pending],
  );
  const selectedProduct = useMemo(
    () => products.find((item) => item.node.id === productId)?.node,
    [products, productId],
  );
  const productsById = useMemo(
    () => new Map(products.map((product) => [product.node.id, product.node])),
    [products],
  );
  const visibleGroups = useMemo(() => {
    const query = normalizeText(groupFilter);
    if (!query) return groups;
    return groups.filter((group) => {
      if (normalizeText(group.name).includes(query)) return true;
      return items.some((item) =>
        item.group_id === group.id && [item.label, item.shopify_product_title]
          .some((value) => normalizeText(value).includes(query)),
      );
    });
  }, [groupFilter, groups, items]);
  const similarProducts = useMemo(() => {
    const referenceTitle = pending[0]?.shopify_product_title;
    if (!referenceTitle) return [];
    return products
      .filter((product) => !unavailableIds.has(product.node.id))
      .map((product) => ({
        product,
        score: productVariationSimilarity(referenceTitle, product.node.title),
      }))
      .filter(({ score }) => score >= 0.6)
      .sort((a, b) => b.score - a.score || a.product.node.title.localeCompare(b.product.node.title, "pt-BR"))
      .slice(0, 12)
      .map(({ product }) => product);
  }, [products, pending, unavailableIds]);

  const handleProductChange = (nextProductId: string) => {
    setProductId(nextProductId);
    const product = products.find((item) => item.node.id === nextProductId);
    setLabel(product ? suggestLabel(product.node.title) : "");
    if (!groupName && product) {
      setGroupName(product.node.title.replace(/\d+(?:[.,]\d+)?\s*(?:kg|g|mg|ml|l)\b/gi, "").trim());
    }
  };

  const addPendingItem = () => {
    const product = products.find((item) => item.node.id === productId);
    if (!product) return toast.error("Selecione um produto");
    if (!label.trim()) return toast.error("Informe o nome da opção, como 1 kg");

    setPending((current) => [
      ...current,
      {
        shopify_product_id: product.node.id,
        shopify_product_handle: product.node.handle,
        shopify_product_title: product.node.title,
        label: label.trim(),
      },
    ]);
    setProductId("");
    setLabel("");
  };

  const addSuggestedItem = (product: ShopifyProduct) => {
    const suggestedLabel = suggestLabel(product.node.title);
    if (!suggestedLabel) {
      handleProductChange(product.node.id);
      toast.info("Confira e informe o nome da opção antes de adicionar.");
      return;
    }
    setPending((current) => [
      ...current,
      {
        shopify_product_id: product.node.id,
        shopify_product_handle: product.node.handle,
        shopify_product_title: product.node.title,
        label: suggestedLabel,
      },
    ]);
  };

  const saveGroup = async () => {
    if (!groupName.trim()) return toast.error("Informe o nome do grupo");
    if (pending.length < 2) return toast.error("Adicione pelo menos dois produtos ao grupo");

    setSaving(true);
    const { data: group, error: groupError } = await supabase
      .from("product_variation_groups")
      .insert({ name: groupName.trim() })
      .select()
      .single();

    if (groupError || !group) {
      setSaving(false);
      return toast.error("Erro ao criar grupo: " + (groupError?.message || ""));
    }

    const { error: itemsError } = await supabase.from("product_variation_items").insert(
      pending.map((item, sortOrder) => ({
        group_id: group.id,
        ...item,
        sort_order: sortOrder,
      })),
    );

    if (itemsError) {
      await supabase.from("product_variation_groups").delete().eq("id", group.id);
      setSaving(false);
      return toast.error("Erro ao vincular produtos: " + itemsError.message);
    }

    invalidateProductVariationsCache();
    setGroupName("");
    setPending([]);
    setProductId("");
    setLabel("");
    setSaving(false);
    toast.success("Grupo de variações criado");
    load();
  };

  const deleteGroup = async (group: VariationGroup) => {
    if (!confirm(`Excluir o grupo "${group.name}"?`)) return;
    const { error } = await supabase.from("product_variation_groups").delete().eq("id", group.id);
    if (error) return toast.error("Erro ao excluir: " + error.message);
    invalidateProductVariationsCache();
    setGroups((current) => current.filter((item) => item.id !== group.id));
    setItems((current) => current.filter((item) => item.group_id !== group.id));
    toast.success("Grupo excluído");
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="p-4 pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Boxes className="h-4 w-4" />
            Criar grupo de variações
          </CardTitle>
          <CardDescription>
            Agrupe produtos separados, como Ração 1 kg, 3 kg e 15 kg, para aparecerem como opções do mesmo item.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 p-4 pt-0">
          <div>
            <label className="mb-1 block text-sm font-medium">Nome do grupo</label>
            <Input
              value={groupName}
              onChange={(event) => setGroupName(event.target.value)}
              placeholder="Ex.: Ração Golden Special"
            />
          </div>

          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto] md:items-end">
            <div>
              <label className="mb-1 block text-sm font-medium">Produto</label>
              <ProductPicker
                products={products}
                value={productId}
                onChange={handleProductChange}
                excludeIds={unavailableIds}
              />
              {selectedProduct && (
                <div className="mt-2 flex items-center gap-2 rounded-md border bg-muted/30 p-2">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white">
                    {selectedProduct.images.edges[0]?.node ? (
                      <img
                        src={selectedProduct.images.edges[0].node.url}
                        alt=""
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <Boxes className="h-4 w-4 text-muted-foreground" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Produto selecionado</p>
                    <p className="break-words text-sm font-semibold text-foreground">
                      {selectedProduct.title}
                    </p>
                  </div>
                </div>
              )}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Nome da opção</label>
              <Input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Ex.: 1 kg"
                disabled={!productId}
                onKeyDown={(event) => event.key === "Enter" && addPendingItem()}
              />
            </div>
            <Button type="button" onClick={addPendingItem} disabled={!productId || !label.trim()}>
              <Plus className="mr-2 h-4 w-4" />
              Adicionar
            </Button>
          </div>

          {pending.length > 0 && (
            <div className="space-y-2 rounded-lg border p-3">
              {pending.map((item, index) => (
                <div key={item.shopify_product_id} className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-white">
                      {productsById.get(item.shopify_product_id)?.images.edges[0]?.node ? (
                        <img
                          src={productsById.get(item.shopify_product_id)!.images.edges[0].node.url}
                          alt=""
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <Boxes className="h-4 w-4 text-muted-foreground" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <span className="rounded-md bg-primary px-2 py-1 text-xs font-bold text-primary-foreground">
                        {item.label}
                      </span>
                      <p className="mt-1 break-words text-sm font-semibold text-foreground">
                        {item.shopify_product_title}
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setPending((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {similarProducts.length > 0 && (
            <div className="rounded-lg border border-sky-200 bg-sky-50/50 p-3">
              <div className="mb-3 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-sky-600" />
                <div>
                  <p className="text-sm font-bold text-sky-900">Produtos parecidos</p>
                  <p className="text-xs text-sky-700">Clique para adicionar ao grupo sem precisar pesquisar novamente.</p>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {similarProducts.map((product) => {
                  const image = product.node.images.edges[0]?.node;
                  const suggestedLabel = suggestLabel(product.node.title);
                  return (
                    <button
                      key={product.node.id}
                      type="button"
                      onClick={() => addSuggestedItem(product)}
                      className="flex items-center gap-3 rounded-lg border bg-white p-2 text-left transition hover:border-sky-400 hover:shadow-sm"
                    >
                      <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                        {image ? (
                          <img src={image.url} alt="" className="h-full w-full object-contain" />
                        ) : (
                          <Boxes className="h-5 w-5 text-muted-foreground" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 text-xs font-semibold text-foreground">{product.node.title}</span>
                        <span className="mt-1 flex items-center gap-1 text-xs font-bold text-sky-700">
                          <Plus className="h-3 w-3" />
                          {suggestedLabel ? `Adicionar ${suggestedLabel}` : "Selecionar"}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <Button onClick={saveGroup} disabled={saving || pending.length < 2} className="w-full">
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar grupo
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 pb-3">
          <CardTitle className="text-base">Grupos cadastrados ({groups.length})</CardTitle>
          <CardDescription>
            Os grupos mais recentes aparecem primeiro. Pesquise pelo nome do grupo, produto ou tamanho.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {!loading && groups.length > 0 && (
            <Input
              className="mb-3"
              value={groupFilter}
              onChange={(event) => setGroupFilter(event.target.value)}
              placeholder="Buscar grupo, produto ou tamanho..."
            />
          )}
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : groups.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nenhum grupo cadastrado.</p>
          ) : visibleGroups.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma variação encontrada para essa busca.</p>
          ) : (
            <div className="space-y-3">
              {visibleGroups.map((group) => (
                <div key={group.id} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-bold">{group.name}</p>
                    <Button variant="ghost" size="icon" onClick={() => deleteGroup(group)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {items
                      .filter((item) => item.group_id === group.id)
                      .map((item) => (
                        <span key={item.id} className="flex items-center gap-2 rounded-lg border bg-muted/40 p-2 text-sm">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white">
                            {productsById.get(item.shopify_product_id)?.images.edges[0]?.node ? (
                              <img
                                src={productsById.get(item.shopify_product_id)!.images.edges[0].node.url}
                                alt=""
                                className="h-full w-full object-contain"
                                loading="lazy"
                              />
                            ) : (
                              <Boxes className="h-4 w-4 text-muted-foreground" />
                            )}
                          </span>
                          <span>
                            <strong>{item.label}</strong>
                            <span className="ml-2 font-medium text-foreground">{item.shopify_product_title}</span>
                          </span>
                        </span>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
