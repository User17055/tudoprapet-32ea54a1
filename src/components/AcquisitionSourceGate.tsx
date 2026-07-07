import { useEffect, useState } from "react";
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
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [source, setSource] = useState("");
  const [referralCode, setReferralCode] = useState("");

  useEffect(() => {
    if (loading || !user) {
      setOpen(false);
      return;
    }

    const checkProfile = async () => {
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

      if (!data?.acquisition_source) {
        setOpen(true);
      }

      setChecking(false);
    };

    checkProfile();
  }, [loading, user]);

  const handleSave = async () => {
    if (!user) return;
    if (!source) {
      toast.error("Informe de onde voce conheceu a TudoPraPet.");
      return;
    }
    if (source === "recomendacao" && !referralCode.trim()) {
      toast.error("Informe o codigo de quem indicou voce.");
      return;
    }
    const normalizedReferralCode = referralCode.trim().toUpperCase();
    if (source === "recomendacao") {
      const { data, error } = await supabase
        .from("employee_referral_codes")
        .select("id")
        .eq("code", normalizedReferralCode)
        .eq("active", true)
        .maybeSingle();

      if (error || !data) {
        toast.error("Codigo de funcionario invalido ou inativo.");
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
      toast.error("Erro ao salvar origem: " + error.message);
      return;
    }

    toast.success("Obrigado! Informacao salva.");
    setOpen(false);
  };

  if (checking || !user) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => next && setOpen(true)}>
      <DialogContent className="max-w-md rounded-2xl">
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
                onChange={(event) => setReferralCode(event.target.value.toUpperCase())}
                placeholder="Ex: JOAO10"
                className="h-12 w-full rounded-xl border border-input bg-background px-4 text-base uppercase outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
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
