/** Extrai o peso da embalagem. Textos mais especificos devem vir primeiro. */
export function parsePackageWeightKg(...values: Array<string | null | undefined>): number | null {
  for (const value of values) {
    const normalized = (value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const match = normalized.match(/(\d+(?:[.,]\d+)?)\s*(kg|quilogramas?|g|gramas?)\b/i);
    if (!match) continue;
    const amount = Number(match[1].replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const unit = match[2].toLocaleLowerCase("pt-BR");
    return unit === "g" || unit.startsWith("grama") ? amount / 1000 : amount;
  }
  return null;
}
