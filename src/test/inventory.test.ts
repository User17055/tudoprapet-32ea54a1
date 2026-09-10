import { describe, expect, it } from "vitest";
import { hasSufficientInventory } from "../../supabase/functions/_shared/inventory.ts";

describe("validação de estoque do checkout", () => {
  it("recusa 15 unidades quando o estoque real é 4", () => {
    expect(hasSufficientInventory({
      availableForSale: true,
      quantityAvailable: 4,
      inventoryTracked: true,
    }, 15)).toBe(false);
  });

  it("recusa estoque desconhecido em vez de assumir quantidade ilimitada", () => {
    expect(hasSufficientInventory({
      availableForSale: true,
      quantityAvailable: null,
      inventoryTracked: null,
    }, 1)).toBe(false);
  });

  it("aceita produto explicitamente configurado sem rastreamento", () => {
    expect(hasSufficientInventory({
      availableForSale: true,
      quantityAvailable: null,
      inventoryTracked: false,
    }, 15)).toBe(true);
  });
});
