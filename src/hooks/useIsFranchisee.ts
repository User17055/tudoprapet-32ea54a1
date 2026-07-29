import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

let cachedUserId: string | null = null;
let cachedIsFranchisee = false;
let pendingUserId: string | null = null;
let pendingProfile: Promise<boolean> | null = null;

async function fetchIsFranchisee(userId: string) {
  if (cachedUserId === userId) return cachedIsFranchisee;
  if (pendingProfile && pendingUserId === userId) return pendingProfile;

  pendingUserId = userId;
  pendingProfile = (async () => {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("is_franchisee")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      cachedUserId = userId;
      cachedIsFranchisee = Boolean(data?.is_franchisee);
      return cachedIsFranchisee;
    } finally {
      pendingProfile = null;
      pendingUserId = null;
    }
  })();
  return pendingProfile;
}

export function useIsFranchisee() {
  const { user, loading: authLoading } = useAuth();
  const hasCachedProfile = Boolean(user && cachedUserId === user.id);
  const [isFranchisee, setIsFranchisee] = useState(
    hasCachedProfile ? cachedIsFranchisee : false,
  );
  const [loading, setLoading] = useState(authLoading || Boolean(user && !hasCachedProfile));

  useEffect(() => {
    if (authLoading) {
      setLoading(true);
      return;
    }

    if (!user) {
      cachedUserId = null;
      cachedIsFranchisee = false;
      setIsFranchisee(false);
      setLoading(false);
      return;
    }

    if (cachedUserId === user.id) {
      setIsFranchisee(cachedIsFranchisee);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    fetchIsFranchisee(user.id)
      .then((value) => {
        if (!cancelled) setIsFranchisee(value);
      })
      .catch((error) => {
        console.error("Failed to load franchisee profile:", error);
        if (!cancelled) setIsFranchisee(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, user]);

  return { isFranchisee, loading };
}
