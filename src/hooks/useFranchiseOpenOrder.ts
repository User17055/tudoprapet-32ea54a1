import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface FranchiseOpenOrderItem {
  variantId: string;
  quantity: number;
  title: string;
  variantTitle: string;
  imageUrl: string | null;
  unitPrice: number;
}

export interface FranchiseOpenOrder {
  id: string;
  items: FranchiseOpenOrderItem[];
  reserved_until: string;
  created_at: string;
  updated_at: string;
}

export type OpenOrderInputItem = { variantId: string; quantity: number };

export function useFranchiseOpenOrder(enabled = true) {
  const [order, setOrder] = useState<FranchiseOpenOrder | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [busy, setBusy] = useState(false);

  const invoke = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("franchise-open-order", { body });
    if (error || data?.error) throw new Error(data?.error || error?.message || "Não foi possível atualizar o pedido");
    return data as { order: FranchiseOpenOrder | null };
  }, []);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setOrder(null);
      setLoading(false);
      return null;
    }
    setLoading(true);
    try {
      const data = await invoke({ action: "get" });
      setOrder(data.order);
      return data.order;
    } finally {
      setLoading(false);
    }
  }, [enabled, invoke]);

  useEffect(() => { void refresh().catch(console.error); }, [refresh]);

  const mutate = useCallback(async (action: "save" | "add" | "replace" | "cancel", items?: OpenOrderInputItem[]) => {
    setBusy(true);
    try {
      const data = await invoke({ action, ...(items ? { items } : {}) });
      setOrder(data.order);
      return data.order;
    } finally {
      setBusy(false);
    }
  }, [invoke]);

  return {
    order,
    loading,
    busy,
    refresh,
    save: (items: OpenOrderInputItem[]) => mutate("save", items),
    add: (items: OpenOrderInputItem[]) => mutate("add", items),
    replace: (items: OpenOrderInputItem[]) => mutate("replace", items),
    cancel: () => mutate("cancel"),
  };
}
