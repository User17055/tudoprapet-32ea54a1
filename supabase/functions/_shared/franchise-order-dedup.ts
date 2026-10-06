export type FranchiseOrderDedupItem = { variantId: string; quantity: number };

export function franchiseOrderFingerprintSource(
  userId: string,
  items: FranchiseOrderDedupItem[],
  shippingCode: string,
  invoicePurpose: string,
): string {
  const normalizedItems = items
    .map((item) => `${item.variantId}:${item.quantity}`)
    .sort()
    .join("|");
  return [userId, normalizedItems, shippingCode, invoicePurpose].join("\n");
}

export async function franchiseOrderFingerprint(
  userId: string,
  items: FranchiseOrderDedupItem[],
  shippingCode: string,
  invoicePurpose: string,
): Promise<string> {
  const source = franchiseOrderFingerprintSource(userId, items, shippingCode, invoicePurpose);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
