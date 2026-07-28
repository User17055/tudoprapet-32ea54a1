import { useEffect, useMemo, useState } from "react";
import { Boxes, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ProductPicker } from "@/components/admin/ProductPicker";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllShopifyProducts, type ShopifyProduct } from "@/lib/shopify";
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

  const load = async () => {
    setLoading(true);
    try {
      const [shop, groupRows, itemRows] = await Promise.all([
        fetchAllShopifyProducts(),
        supabase.from("product_variation_groups").select("*").order("created_at"),
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
                  <div className="min-w-0">
                    <span className="mr-2 rounded-md bg-primary px-2 py-1 text-xs font-bold text-primary-foreground">
                      {item.label}
                    </span>
                    <span className="text-sm text-muted-foreground">{item.shopify_product_title}</span>
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

          <Button onClick={saveGroup} disabled={saving || pending.length < 2} className="w-full">
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar grupo
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 pb-3">
          <CardTitle className="text-base">Grupos cadastrados ({groups.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : groups.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nenhum grupo cadastrado.</p>
          ) : (
            <div className="space-y-3">
              {groups.map((group) => (
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
                        <span key={item.id} className="rounded-lg border bg-muted/40 px-3 py-1.5 text-sm">
                          <strong>{item.label}</strong>
                          <span className="ml-2 text-xs text-muted-foreground">{item.shopify_product_title}</span>
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
