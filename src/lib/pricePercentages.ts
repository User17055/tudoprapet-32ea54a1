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
