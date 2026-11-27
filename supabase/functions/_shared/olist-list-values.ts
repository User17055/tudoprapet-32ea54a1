export const priceListIds = { franchise: "1872", subscriber: "1871" } as const;

export function positiveMoney(value: unknown): number | null {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : null;
}

export function effectiveListPrice(sale: number | null, percent: number | undefined,
  exception: { price: unknown; promoPrice: unknown } | undefined): number | null {
  if (percent === undefined) return null;
  if (exception) return positiveMoney(exception.promoPrice) ?? positiveMoney(exception.price);
  return sale === null ? null : positiveMoney(sale * (1 + percent / 100));
}

export function selectCatalogProduct<T extends { status: string | null }>(rows: T[]): T | null {
  if (rows.length <= 1) return rows[0] ?? null;
  const active = rows.filter(row => row.status === "A");
  return active.length === 1 ? active[0] : null;
}
