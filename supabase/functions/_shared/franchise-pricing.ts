import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { fetchOlistCostBySku, type OlistCost } from "./olist.ts";
import { applyProductCost, loadSubscriberMarginRules, type SubscriberMarginRules } from "./olist-cost-apply.ts";

/**
 * Franquia paga custo — nunca o preço cheio por falta de cadastro.
 *
 * Antes de precificar um carrinho de franquia, garante que cada item tenha
 * custo ou preço de franquia:
 *  1. sem custo: busca na Olist pelo SKU e grava com a mesma regra do admin;
 *     sem como buscar, o item é BLOQUEADO e registrado para o admin. Só item
 *     bloqueado pelo sistema pode receber pedido de revisão, então a franquia
 *     não consegue mandar revisar produto que está certo;
 *  2. custo com mais de 7 dias: reconsulta na Olist (sem bloquear se falhar).
 *     A API só é usada quando uma franquia compra, e só para aquele carrinho;
 *  3. preço de franquia = custo, sempre (sem margem).
 *
 * O bloqueio acontece antes de qualquer pedido, nota ou boleto na Olist.
 */

export interface FranchisePricingItem {
  variantId: string;
  productId: string;
  sku: string;
  title: string;
  catalogPrice: number | null;
}

export type FranchiseBlockReason = "missing_sku" | "not_found_in_olist" | "olist_unavailable";

export interface FranchiseBlockedItem {
  variantId: string;
  productId: string;
  title: string;
  reason: FranchiseBlockReason;
  reviewStatus: string;
  canRequestReview: boolean;
  message: string;
}

export const FRANCHISE_PRICE_BLOCKED_MESSAGE =
  "Alguns produtos estão sem preço de franquia no momento. Remova-os ou peça a revisão para continuar.";

// Cada consulta à Olist conta no limite do plano (30/min) e atrasa o checkout.
const DEFAULT_MAX_LOOKUPS = 5;
const DEFAULT_LOOKUP_TIMEOUT_MS = 8_000;
// Custo mais velho que isto é reconsultado na Olist quando uma franquia compra.
export const STALE_COST_DAYS = 7;

type CostLookup = (sku: string, token: string) => Promise<OlistCost | null>;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: number | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Tempo esgotado ao consultar a Olist")), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export function blockedItemMessage(status: string, decisionNote: string | null, alreadyRequested: boolean): string {
  if (status === "rejected") {
    return `Produto indisponível para franquia${decisionNote ? `: ${decisionNote}` : "."}`;
  }
  if (alreadyRequested || status === "requested") {
    return "Revisão já solicitada. Avisaremos no seu painel quando o produto for liberado.";
  }
  return "Produto sem preço de franquia no momento.";
}

export async function ensureFranchiseCosts(
  admin: SupabaseClient,
  rawItems: FranchisePricingItem[],
  options: {
    token?: string;
    userId?: string;
    maxLookups?: number;
    timeoutMs?: number;
    lookup?: CostLookup;
    /** Grava o custo encontrado (padrão: mesma regra do admin). Injetável nos testes. */
    applyCost?: (item: FranchisePricingItem, cost: number) => Promise<void>;
    /** Relógio injetável nos testes. */
    now?: number;
  } = {},
): Promise<{ blocked: FranchiseBlockedItem[]; resolved: string[]; refreshed: string[] }> {
  const items = [...new Map(rawItems.map((item) => [item.variantId, item])).values()];
  if (!items.length) return { blocked: [], resolved: [], refreshed: [] };
  const variantIds = items.map((item) => item.variantId);
  const [costResult, priceResult] = await Promise.all([
    // leitura-limitada: variantes do carrinho
    admin.from("product_costs").select("shopify_variant_id,cost,synced_at").in("shopify_variant_id", variantIds),
    // leitura-limitada: variantes do carrinho
    admin.from("franchise_prices").select("shopify_variant_id,price").in("shopify_variant_id", variantIds),
  ]);
  if (costResult.error) throw costResult.error;
  if (priceResult.error) throw priceResult.error;
  const positive = (value: unknown) => Number.isFinite(Number(value)) && Number(value) > 0;
  const costs = new Map<string, { cost: number; syncedAt: number | null }>(
    (costResult.data ?? []).filter((row) => positive(row.cost)).map((row) => [
      row.shopify_variant_id,
      { cost: Number(row.cost), syncedAt: row.synced_at ? Date.parse(row.synced_at) : null },
    ]),
  );
  const franchisePrices = new Map(
    (priceResult.data ?? []).filter((row) => positive(row.price))
      .map((row) => [row.shopify_variant_id, Number(row.price)]),
  );

  const lookup = options.lookup ?? fetchOlistCostBySku;
  const maxLookups = options.maxLookups ?? DEFAULT_MAX_LOOKUPS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOOKUP_TIMEOUT_MS;
  const now = options.now ?? Date.now();
  let lookups = 0;
  let rules: SubscriberMarginRules | null = null;
  const resolved: string[] = [];
  const refreshed: string[] = [];
  const pending: Array<FranchisePricingItem & { reason: FranchiseBlockReason }> = [];

  // Grava o custo (e, com ele, preço de franquia = custo e preço de assinante).
  const saveCost = async (item: FranchisePricingItem, sku: string, cost: number) => {
    if (options.applyCost) {
      await options.applyCost(item, cost);
    } else {
      rules ??= await loadSubscriberMarginRules(admin, [
        ...new Set(items.map((entry) => entry.productId)),
      ]);
      await applyProductCost(admin, { productId: item.productId, variantId: item.variantId, sku }, cost, rules);
    }
    costs.set(item.variantId, { cost, syncedAt: now });
    franchisePrices.set(item.variantId, cost);
  };

  // 1. Sem custo: busca na Olist; se não resolver, o item é bloqueado.
  //    Tem prioridade no limite de consultas porque é o que pode travar a compra.
  for (const item of items) {
    if (costs.has(item.variantId)) continue;
    const hasFranchisePrice = franchisePrices.has(item.variantId);
    const sku = item.sku.trim();
    let reason: FranchiseBlockReason | null = null;
    if (!sku) {
      reason = "missing_sku";
    } else if (!options.token || lookups >= maxLookups) {
      reason = "olist_unavailable";
    } else {
      lookups++;
      try {
        const product = await withTimeout(lookup(sku, options.token), timeoutMs);
        if (product && product.cost > 0) {
          await saveCost(item, sku, product.cost);
          resolved.push(item.variantId);
          continue;
        }
        reason = "not_found_in_olist";
      } catch (error) {
        console.error(`franchise-pricing custo ${sku}:`, error);
        reason = "olist_unavailable";
      }
    }
    // Preço de franquia definido pelo admin vale mesmo sem custo conhecido.
    if (hasFranchisePrice) continue;
    pending.push({ ...item, reason });
  }

  // 2. Custo sincronizado há mais de 7 dias: reconsulta com o que sobrou do
  //    limite, do mais antigo para o mais novo. Só acontece quando uma franquia
  //    compra o produto (sem rotina diária na API). Falha aqui nunca bloqueia:
  //    o pedido segue com o custo já cadastrado.
  const staleBefore = now - STALE_COST_DAYS * 86_400_000;
  const stale = items
    .filter((item) => {
      const current = costs.get(item.variantId);
      return current && !resolved.includes(item.variantId) && item.sku.trim() &&
        (current.syncedAt === null || current.syncedAt < staleBefore);
    })
    .sort((a, b) => (costs.get(a.variantId)!.syncedAt ?? 0) - (costs.get(b.variantId)!.syncedAt ?? 0));
  for (const item of stale) {
    if (!options.token || lookups >= maxLookups) break;
    lookups++;
    const sku = item.sku.trim();
    try {
      const product = await withTimeout(lookup(sku, options.token), timeoutMs);
      if (product && product.cost > 0) {
        await saveCost(item, sku, product.cost);
        refreshed.push(item.variantId);
      }
    } catch (error) {
      console.error(`franchise-pricing atualização de custo ${sku}:`, error);
    }
  }

  // 3. Franquia paga custo: o preço de franquia acompanha o custo para cima e
  //    para baixo. Corrige o que estiver faltando ou diferente (inclusive valor
  //    digitado à mão acima do custo).
  const misaligned = items.filter((item) => {
    const current = costs.get(item.variantId);
    return current && franchisePrices.get(item.variantId) !== current.cost;
  });
  if (misaligned.length) {
    const { error } = await admin.from("franchise_prices").upsert(
      misaligned.map((item) => ({
        shopify_product_id: item.productId,
        shopify_variant_id: item.variantId,
        price: costs.get(item.variantId)!.cost,
      })),
      { onConflict: "shopify_variant_id" },
    );
    if (error) throw error;
  }

  if (!pending.length) return { blocked: [], resolved, refreshed };

  for (const item of pending) {
    const { error } = await admin.rpc("record_franchise_price_block", {
      p_variant_id: item.variantId,
      p_product_id: item.productId,
      p_sku: item.sku,
      p_title: item.title,
      p_catalog_price: item.catalogPrice,
      p_reason: item.reason,
    });
    if (error) throw error;
  }
  // leitura-limitada: itens bloqueados deste carrinho
  const { data: reviews, error: reviewsError } = await admin.from("franchise_price_reviews")
    .select("id,shopify_variant_id,status,decision_note")
    .in("shopify_variant_id", pending.map((item) => item.variantId));
  if (reviewsError) throw reviewsError;
  const reviewByVariant = new Map((reviews ?? []).map((row) => [row.shopify_variant_id, row]));
  let requestedByUser = new Set<string>();
  if (options.userId && reviews?.length) {
    // leitura-limitada: itens bloqueados deste carrinho
    const { data: requests, error } = await admin.from("franchise_price_review_requests")
      .select("review_id")
      .eq("user_id", options.userId)
      .in("review_id", reviews.map((row) => row.id));
    if (error) throw error;
    requestedByUser = new Set((requests ?? []).map((row) => row.review_id));
  }

  const blocked = pending.map((item) => {
    const review = reviewByVariant.get(item.variantId);
    const status = review?.status || "blocked";
    const alreadyRequested = !!review && requestedByUser.has(review.id);
    return {
      variantId: item.variantId,
      productId: item.productId,
      title: item.title,
      reason: item.reason,
      reviewStatus: status,
      canRequestReview: ["blocked", "requested"].includes(status) && !alreadyRequested,
      message: blockedItemMessage(status, review?.decision_note ?? null, alreadyRequested),
    };
  });
  return { blocked, resolved, refreshed };
}
