import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface Category {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  sort_order: number;
}

export function useCategoryTree() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    supabase
      .from("categories")
      .select("*")
      .order("sort_order")
      .order("name")
      .then(({ data }) => {
        if (!active) return;
        setCategories((data || []) as Category[]);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const rootCats = useMemo(() => categories.filter((c) => !c.parent_id), [categories]);

  const childrenOf = useMemo(() => {
    const map = new Map<string, Category[]>();
    for (const c of categories) {
      if (!c.parent_id) continue;
      if (!map.has(c.parent_id)) map.set(c.parent_id, []);
      map.get(c.parent_id)!.push(c);
    }
    return map;
  }, [categories]);

  return { categories, rootCats, childrenOf, loading };
}
