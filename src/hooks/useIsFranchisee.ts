import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function useIsFranchisee() {
  const { user } = useAuth();
  const [isFranchisee, setIsFranchisee] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setIsFranchisee(false);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("is_franchisee")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!cancelled) {
        setIsFranchisee(Boolean(data?.is_franchisee));
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  return { isFranchisee, loading };
}
