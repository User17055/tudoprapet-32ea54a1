import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  franchiseOrderFingerprint,
  franchiseOrderFingerprintSource,
} from "./franchise-order-dedup.ts";

Deno.test("pedido de franquia igual gera a mesma chave independentemente da ordem dos itens", async () => {
  const first = [
    { variantId: "gid://shopify/ProductVariant/2", quantity: 1 },
    { variantId: "gid://shopify/ProductVariant/1", quantity: 3 },
  ];
  const reversed = [...first].reverse();
  assertEquals(
    franchiseOrderFingerprintSource("user-1", first, "shipping", "resale"),
    franchiseOrderFingerprintSource("user-1", reversed, "shipping", "resale"),
  );
  assertEquals(
    await franchiseOrderFingerprint("user-1", first, "shipping", "resale"),
    await franchiseOrderFingerprint("user-1", reversed, "shipping", "resale"),
  );
});

Deno.test("quantidade, entrega, finalidade ou franqueado diferente permite outro pedido", async () => {
  const items = [{ variantId: "gid://shopify/ProductVariant/1", quantity: 1 }];
  const base = await franchiseOrderFingerprint("user-1", items, "shipping", "resale");
  assertNotEquals(
    base,
    await franchiseOrderFingerprint("user-1", [{ ...items[0], quantity: 2 }], "shipping", "resale"),
  );
  assertNotEquals(base, await franchiseOrderFingerprint("user-1", items, "pick_up", "resale"));
  assertNotEquals(
    base,
    await franchiseOrderFingerprint("user-1", items, "shipping", "final_consumption"),
  );
  assertNotEquals(base, await franchiseOrderFingerprint("user-2", items, "shipping", "resale"));
});
