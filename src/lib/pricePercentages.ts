export function percentageOverCost(value: number | null | undefined, cost: number | null | undefined): number | null {
  if (!Number.isFinite(value) || !Number.isFinite(cost) || Number(cost) <= 0) return null;
  return ((Number(value) / Number(cost)) - 1) * 100;
}

export function percentageBelowSale(value: number | null | undefined, sale: number | null | undefined): number | null {
  if (!Number.isFinite(value) || !Number.isFinite(sale) || Number(sale) <= 0) return null;
  return (1 - (Number(value) / Number(sale))) * 100;
}

export function formatPercentage(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value) + "%";
}

export type PriceRisk = "no-cost" | "danger" | "warning" | "safe";

export function priceRisk(value: number | null | undefined, cost: number | null | undefined): PriceRisk {
  const percent = percentageOverCost(value, cost);
  if (percent === null) return "no-cost";
  // A cor segue o mesmo percentual com uma casa exibido na tela, evitando que
  // 110 / 100 vire 10.000000000000009 e caia na faixa errada.
  const displayedPercent = Math.round(percent * 10) / 10;
  if (displayedPercent <= 10) return "danger";
  if (displayedPercent <= 15) return "warning";
  return "safe";
}
