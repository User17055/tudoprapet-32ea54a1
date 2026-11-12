import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, PencilLine, SearchCheck, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export interface FranchisePriceReview {
  id: string;
  shopify_variant_id: string;
  sku: string | null;
  product_title: string | null;
  catalog_price: number | null;
  reason: "missing_sku" | "not_found_in_olist" | "olist_unavailable";
  status: "blocked" | "requested" | "approved" | "changed" | "rejected";
  block_count: number;
  last_blocked_at: string;
  requested_at: string | null;
  decided_at: string | null;
  decided_by_email: string | null;
  decision_cost: number | null;
  decision_note: string | null;
  requesters: string[];
}

const REASONS: Record<FranchisePriceReview["reason"], string> = {
  missing_sku: "Produto sem SKU na loja",
  not_found_in_olist: "SKU sem custo na Olist",
  olist_unavailable: "Olist não respondeu na hora da compra",
};

const DECISIONS: Partial<Record<FranchisePriceReview["status"], string>> = {
  approved: "Aprovado com o custo da Olist",
  changed: "Custo alterado",
  rejected: "Recusado",
};

const money = (value: number | null) =>
  value === null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value));

type Decision = { review: FranchisePriceReview; kind: "change" | "reject" };

/**
 * Produtos que o checkout de franquia bloqueou por falta de custo. Só os
 * aprovadores de preço podem decidir; os demais admins acompanham.
 */
export function FranchisePriceReviewsCard({ onCountChange }: { onCountChange?: (count: number) => void }) {
  const [reviews, setReviews] = useState<FranchisePriceReview[]>([]);
  const [canDecide, setCanDecide] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Decision | null>(null);
  const [cost, setCost] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("franchise-price-review", { body: { action: "list" } });
    setLoading(false);
    if (error || data?.error) {
      toast.error("Não foi possível carregar as revisões de preço");
      return;
    }
    const list = Array.isArray(data?.reviews) ? (data.reviews as FranchisePriceReview[]) : [];
    setReviews(list);
    setCanDecide(Boolean(data?.canDecide));
    onCountChange?.(list.filter((review) => review.status === "requested" || review.status === "blocked").length);
  }, [onCountChange]);

  useEffect(() => { void load(); }, [load]);

  const decide = async (review: FranchisePriceReview, decision: "approve" | "change" | "reject", extra: Record<string, unknown> = {}) => {
    setBusy(review.id);
    const { data, error } = await supabase.functions.invoke("franchise-price-review", {
      body: { action: "decide", reviewId: review.id, decision, ...extra },
    });
    setBusy(null);
    if (error || data?.error) {
      let message = data?.error as string | undefined;
      if (!message && error && "context" in error) {
        message = await (error as { context: Response }).context.json().then((body) => body?.error).catch(() => undefined);
      }
      toast.error(message || "Não foi possível salvar a decisão");
      return false;
    }
    toast.success(decision === "reject" ? "Produto recusado para franquia" : "Produto liberado para franquia");
    await load();
    return true;
  };

  const submitDialog = async () => {
    if (!dialog) return;
    const ok = dialog.kind === "change"
      ? await decide(dialog.review, "change", { cost, note })
      : await decide(dialog.review, "reject", { note });
    if (ok) setDialog(null);
  };

  const open = reviews.filter((review) => review.status === "blocked" || review.status === "requested");
  const decided = reviews.filter((review) => !open.includes(review));
  // Pedidos de franquia primeiro: são os que alguém está esperando.
  open.sort((a, b) => Number(b.status === "requested") - Number(a.status === "requested"));

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-base">Revisão de preço de franquia</CardTitle>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Produtos que uma franquia tentou comprar sem custo cadastrado. O sistema já tentou buscar o custo na Olist.
          {!canDecide && " Somente os aprovadores de preço podem decidir."}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <Skeleton className="h-16 w-full" />
        ) : open.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4" /> Nenhum produto aguardando revisão.
          </p>
        ) : (
          <ul className="divide-y divide-border/70">
            {open.map((review) => (
              <li key={review.id} className="flex flex-col gap-3 py-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0 text-sm">
                  <p className="font-semibold text-foreground">
                    {review.product_title || "Produto"}
                    {review.sku && <span className="font-normal text-muted-foreground"> · SKU {review.sku}</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {REASONS[review.reason]} · catálogo {money(review.catalog_price)} · bloqueado {review.block_count}x
                  </p>
                  {review.requesters.length > 0 && (
                    <p className="mt-1 text-xs">
                      <Badge variant="outline" className="mr-1.5 border-amber-200 bg-amber-50 text-amber-800">
                        {review.requesters.length === 1 ? "1 franquia aguardando" : `${review.requesters.length} franquias aguardando`}
                      </Badge>
                      <span className="text-muted-foreground">{review.requesters.join(", ")}</span>
                    </p>
                  )}
                </div>
                {canDecide && (
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button size="sm" className="gap-1" disabled={busy !== null} onClick={() => void decide(review, "approve")}>
                      {busy === review.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SearchCheck className="h-3.5 w-3.5" />}
                      Aprovar (custo da Olist)
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1" disabled={busy !== null} onClick={() => { setCost(""); setNote(""); setDialog({ review, kind: "change" }); }}>
                      <PencilLine className="h-3.5 w-3.5" /> Alterar
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1 text-destructive" disabled={busy !== null} onClick={() => { setNote(""); setDialog({ review, kind: "reject" }); }}>
                      <XCircle className="h-3.5 w-3.5" /> Recusar
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {decided.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">Decididas nos últimos 14 dias ({decided.length})</summary>
            <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
              {decided.map((review) => (
                <li key={review.id}>
                  <span className={cn("font-semibold", review.status === "rejected" ? "text-destructive" : "text-emerald-700")}>
                    {DECISIONS[review.status]}
                  </span>
                  {" · "}{review.product_title}
                  {review.decision_cost !== null && ` · ${money(review.decision_cost)}`}
                  {review.decision_note && ` · ${review.decision_note}`}
                  {review.decided_by_email && ` · por ${review.decided_by_email}`}
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>

      <Dialog open={dialog !== null} onOpenChange={(value) => !value && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog?.kind === "change" ? "Alterar custo" : "Recusar para franquia"}</DialogTitle>
            <DialogDescription>{dialog?.review.product_title}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {dialog?.kind === "change" && (
              <div className="space-y-1.5">
                <Label htmlFor="price-review-cost">Custo (vira o preço de franquia)</Label>
                <Input id="price-review-cost" inputMode="decimal" placeholder="0,00" value={cost} onChange={(event) => setCost(event.target.value)} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="price-review-note">{dialog?.kind === "change" ? "Justificativa" : "Motivo (a franquia verá)"}</Label>
              <Textarea id="price-review-note" maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Cancelar</Button>
            <Button
              disabled={busy !== null || !note.trim() || (dialog?.kind === "change" && !(Number(cost.replace(",", ".")) > 0))}
              variant={dialog?.kind === "reject" ? "destructive" : "default"}
              onClick={() => void submitDialog()}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {dialog?.kind === "change" ? "Salvar custo e liberar" : "Recusar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
