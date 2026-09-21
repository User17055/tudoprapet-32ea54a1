export type MissingValueFilter =
  | "all"
  | "missing_any"
  | "missing_cost"
  | "missing_shopify"
  | "missing_subscriber"
  | "missing_franchise"
  | "subscriber_not_visible";

export type VariantValues = {
  cost: number | null | undefined;
  shopify: number | null | undefined;
  subscriber: number | null | undefined;
  franchise: number | null | undefined;
};

export const isMissingValue = (value: number | null | undefined) => (
  value === null || value === undefined || !Number.isFinite(value) || value <= 0
);

export const isSubscriberPriceNotVisible = (
  subscriber: number | null | undefined,
  shopify: number | null | undefined,
) => !isMissingValue(subscriber) && !isMissingValue(shopify) && subscriber >= shopify;

export function matchesMissingValueFilter(values: VariantValues, filter: MissingValueFilter) {
  if (filter === "all") return true;
  if (filter === "subscriber_not_visible") {
    return isSubscriberPriceNotVisible(values.subscriber, values.shopify);
  }
  const missing = {
    missing_cost: isMissingValue(values.cost),
    missing_shopify: isMissingValue(values.shopify),
    missing_subscriber: isMissingValue(values.subscriber),
    missing_franchise: isMissingValue(values.franchise),
  };
  if (filter === "missing_any") return Object.values(missing).some(Boolean);
  return missing[filter];
}
