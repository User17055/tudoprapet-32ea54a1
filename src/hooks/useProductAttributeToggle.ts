import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export interface ProductAttributeRow {
  id: string;
  shopify_product_id: string;
  attr_key: string;
  attr_value: string;
}

type RowsUpdate = (rows: ProductAttributeRow[]) => ProductAttributeRow[];

interface UseProductAttributeToggleOptions {
  productId: string;
  attrs: ProductAttributeRow[];
  setAttrs: Dispatch<SetStateAction<ProductAttributeRow[]>>;
  setAllProductAttrs: Dispatch<SetStateAction<ProductAttributeRow[]>>;
}

const UNIQUE_VIOLATION = "23505";

const operationKey = (productId: string, key: string, value: string) => `${productId}\u0000${key}\u0000${value}`;
const withRow = (row: ProductAttributeRow): RowsUpdate => (rows) => (
  rows.some((item) => item.id === row.id) ? rows : [...rows, row]
);
const withoutRow = (id: string): RowsUpdate => (rows) => rows.filter((item) => item.id !== id);

// Marca e desmarca um atributo por clique, sem esperar o banco para atualizar a tela.
//
// Por que existe: cada clique relia as tres tabelas de detalhes inteiras (cerca de 2,2 s em
// 05/11/2026, 10 paginas) com todos os botoes travados, o que atrasava o cadastro em sequencia.
// Cada botao agora so bloqueia a si mesmo enquanto grava, e o erro desfaz a marcacao.
export function useProductAttributeToggle({
  productId,
  attrs,
  setAttrs,
  setAllProductAttrs,
}: UseProductAttributeToggleOptions) {
  const [pendingAttributes, setPendingAttributes] = useState<ReadonlySet<string>>(new Set());
  const pendingRef = useRef(new Set<string>());
  const currentProductRef = useRef(productId);
  currentProductRef.current = productId;

  const toggleAttribute = async (key: string, value: string) => {
    if (!productId) return;
    const operation = operationKey(productId, key, value);
    if (pendingRef.current.has(operation)) return;
    pendingRef.current.add(operation);
    setPendingAttributes(new Set(pendingRef.current));

    const targetProductId = productId;
    // A gravacao pode terminar depois de o admin trocar de produto: nesse caso a lista de atributos
    // na tela ja e de outro produto e so o resumo geral recebe a mudanca.
    const apply = (update: RowsUpdate) => {
      if (currentProductRef.current === targetProductId) setAttrs(update);
      setAllProductAttrs(update);
    };

    const existing = attrs.find((attribute) => attribute.attr_key === key && attribute.attr_value === value);
    let undo: RowsUpdate = (rows) => rows;
    try {
      if (existing) {
        undo = withRow(existing);
        apply(withoutRow(existing.id));
        const { error } = await supabase.from("product_attributes").delete().eq("id", existing.id);
        if (error) throw error;
        // Reaplica: uma leitura do produto feita durante a gravacao pode ter trazido o item de volta.
        apply(withoutRow(existing.id));
      } else {
        // O id nasce aqui para a linha ja ser definitiva na tela: outras acoes apagam atributos por id.
        const row: ProductAttributeRow & { sort_order: number } = {
          id: crypto.randomUUID(),
          shopify_product_id: targetProductId,
          attr_key: key,
          attr_value: value,
          sort_order: attrs.length,
        };
        undo = withoutRow(row.id);
        apply(withRow(row));
        const { error } = await supabase.from("product_attributes").insert(row);
        if (error?.code === UNIQUE_VIOLATION) {
          // Outra aba ou outro admin ja marcou: vale a linha do banco, senao desmarcar nao a apagaria.
          const { data, error: readError } = await supabase
            .from("product_attributes")
            .select("id, shopify_product_id, attr_key, attr_value, sort_order")
            .eq("shopify_product_id", targetProductId)
            .eq("attr_key", key)
            .eq("attr_value", value)
            .maybeSingle();
          if (readError || !data) throw readError || error;
          apply((rows) => withRow(data)(withoutRow(row.id)(rows)));
        } else if (error) {
          throw error;
        } else {
          // Reaplica: uma leitura do produto feita durante a gravacao pode nao ter visto a linha.
          apply(withRow(row));
        }
      }
    } catch (error) {
      apply(undo);
      toast.error("Não foi possível atualizar o atributo.");
      console.error(error);
    } finally {
      pendingRef.current.delete(operation);
      setPendingAttributes(new Set(pendingRef.current));
    }
  };

  const isAttributePending = useCallback(
    (key: string, value: string) => pendingAttributes.has(operationKey(productId, key, value)),
    [pendingAttributes, productId],
  );

  return {
    toggleAttribute,
    isAttributePending,
    hasPendingAttributeWrites: pendingAttributes.size > 0,
  };
}
