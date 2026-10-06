import { describe, expect, it } from "vitest";
import {
  hasSufficientFranchiseInventory,
  hasSufficientInventory,
} from "../../supabase/functions/_shared/inventory.ts";

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

  it("recusa para franquia produto sem rastreamento de estoque", () => {
    expect(hasSufficientFranchiseInventory({
      availableForSale: true,
      quantityAvailable: null,
      inventoryTracked: false,
    }, 1)).toBe(false);
  });

  it("aceita para franquia somente estoque rastreado e suficiente", () => {
    expect(hasSufficientFranchiseInventory({
      availableForSale: true,
      quantityAvailable: 4,
      inventoryTracked: true,
    }, 4)).toBe(true);
  });

  it("recusa para franquia quantidade acima do estoque rastreado", () => {
    expect(hasSufficientFranchiseInventory({
      availableForSale: true,
      quantityAvailable: 4,
      inventoryTracked: true,
    }, 5)).toBe(false);
  });
});
