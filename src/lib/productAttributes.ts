// Standard attribute keys used for product details + catalog filters.
// Admin can also add custom keys (free text) — these are just the recommended ones
// that show as dedicated filters in the catalog.
export const STANDARD_ATTR_KEYS = [
  "Linha",
  "Pet",
  "Idade",
  "Formato",
  "Indicação Veterinária",
  "Raça",
  "Sabor",
  "Tipo",
] as const;

export type StandardAttrKey = (typeof STANDARD_ATTR_KEYS)[number];
