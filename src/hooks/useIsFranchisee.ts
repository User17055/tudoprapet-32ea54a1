import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function useIsFranchisee() {
  const { user, loading: authLoading } = useAuth();
  const [isFranchisee, setIsFranchisee] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) {
      setLoading(true);
      return;
    }

    if (!user) {
      setIsFranchisee(false);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("is_franchisee")
          .eq("user_id", user.id)
          .maybeSingle();
        if (error) throw error;
        if (!cancelled) {
          setIsFranchisee(Boolean(data?.is_franchisee));
        }
      } catch (error) {
        console.error("Failed to load franchisee profile:", error);
        if (!cancelled) {
          setIsFranchisee(false);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user]);

  return { isFranchisee, loading };
}
