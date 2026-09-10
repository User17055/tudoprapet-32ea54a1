export interface InventoryState {
  availableForSale: boolean;
  quantityAvailable: number | null;
  inventoryTracked: boolean | null;
}

/**
 * Estoque rastreado precisa ter uma quantidade conhecida e suficiente.
 * Somente produtos explicitamente configurados sem rastreamento podem ser
 * vendidos sem limite numérico. Falha de permissão/API nunca vira permissão
 * para vender acima do estoque.
 */
export function hasSufficientInventory(
  state: InventoryState,
  requestedQuantity: number,
): boolean {
  if (!state.availableForSale) return false;
  if (state.inventoryTracked === false) return true;
  return state.quantityAvailable !== null &&
    Number.isInteger(state.quantityAvailable) &&
    state.quantityAvailable >= requestedQuantity;
}
