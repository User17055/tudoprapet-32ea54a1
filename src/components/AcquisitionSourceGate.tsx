import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const SOURCE_OPTIONS = [
  { value: "google", label: "Google" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "tiktok", label: "TikTok" },
  { value: "recomendacao", label: "Recomendacao" },
  { value: "outro", label: "Outro" },
];

export const AcquisitionSourceGate = () => {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [referralErrorEffect, setReferralErrorEffect] = useState(false);
  const [source, setSource] = useState("");
  const [referralCode, setReferralCode] = useState("");

  const getStorageKey = (userId: string) => `tudoprapet:acquisition-source:${userId}`;
  const hiddenRoutes = ["/login", "/cadastro", "/esqueci-senha", "/redefinir-senha"];
  const shouldHideOnRoute = hiddenRoutes.includes(location.pathname);

  useEffect(() => {
    if (loading || !user || shouldHideOnRoute) {
      setOpen(false);
      setCompleted(false);
      return;
    }

    const checkProfile = async () => {
      if (localStorage.getItem(getStorageKey(user.id)) === "done") {
        setOpen(false);
        return;
      }

      setChecking(true);
      const { data, error } = await supabase
        .from("profiles")
        .select("id, acquisition_source, referral_code")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) {
        console.error("Failed to check acquisition source:", error);
        setChecking(false);
        return;
      }

      if (data?.acquisition_source) {
        localStorage.setItem(getStorageKey(user.id), "done");
      } else {
        setOpen(true);
      }

      setChecking(false);
    };

    checkProfile();
  }, [loading, shouldHideOnRoute, user]);

  const handleSave = async () => {
    if (!user) return;
    const showError = (message: string, target?: "referral") => {
      toast.error(message);
      if (target === "referral") {
        setReferralErrorEffect(false);
        window.setTimeout(() => setReferralErrorEffect(true), 10);
        window.setTimeout(() => setReferralErrorEffect(false), 650);
      }
    };

    if (!source) {
      showError("Informe de onde voce conheceu a TudoPraPet.");
      return;
    }
    if (source === "recomendacao" && !referralCode.trim()) {
      showError("Informe o codigo de quem indicou voce.", "referral");
      return;
    }
    const normalizedReferralCode = referralCode.trim().toUpperCase();
    if (source === "recomendacao") {
      const { data, error } = await supabase.rpc("validate_referral_code", {
        _code: normalizedReferralCode,
      });

      if (error || !data) {
        showError("Codigo de funcionario invalido ou inativo.", "referral");
        return;
      }
    }

    setSaving(true);
    const payload = {
      user_id: user.id,
      email: user.email,
      acquisition_source: source,
      referral_code: source === "recomendacao" ? normalizedReferralCode : null,
    };

    const { error } = await supabase
      .from("profiles")
      .upsert(payload, { onConflict: "user_id" });

    setSaving(false);
    if (error) {
      showError("Erro ao salvar origem: " + error.message);
      return;
    }

    localStorage.setItem(getStorageKey(user.id), "done");
    toast.success("Obrigado! Informacao salva.");
    setCompleted(true);
    window.setTimeout(() => {
      setOpen(false);
      setCompleted(false);
    }, 450);
  };

  if (checking || !user) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className={`max-w-md rounded-2xl transition-all duration-300 data-[state=open]:slide-in-from-bottom-4 ${
          completed
            ? "scale-95 border-pet-green opacity-0 ring-4 ring-pet-green/20"
            : "border-border"
        }`}
      >
        <DialogHeader>
          <DialogTitle>Antes de continuar</DialogTitle>
          <DialogDescription>
            Conta pra gente de onde voce veio. Essa informacao ajuda a TudoPraPet a
            acompanhar indicacoes e campanhas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-bold text-foreground">
              Como voce conheceu a TudoPraPet?
            </label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger className="h-12 rounded-xl">
                <SelectValue placeholder="Selecione uma opcao" />
              </SelectTrigger>
              <SelectContent>
                {SOURCE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {source === "recomendacao" && (
            <div className="space-y-2">
              <label className="text-sm font-bold text-foreground">
                Codigo de indicacao
              </label>
              <input
                value={referralCode}
                onChange={(event) => {
                  setReferralCode(event.target.value.toUpperCase());
                  setReferralErrorEffect(false);
                }}
                placeholder="Ex: JOAO10"
                className={`h-12 w-full rounded-xl border bg-background px-4 text-base uppercase outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 ${
                  referralErrorEffect
                    ? "animate-[shake-input_0.35s_ease-in-out] border-destructive ring-4 ring-destructive/20"
                    : "border-input"
                }`}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={handleSave} disabled={saving} className="h-12 rounded-xl font-bold">
            {saving ? "Salvando..." : "Continuar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
