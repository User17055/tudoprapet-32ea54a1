export type SuggestionCategory = {
  id: string;
  name: string;
  parent_id: string | null;
};

export type SuggestionBrand = { id: string; name: string };
export type SuggestionAttribute = { attr_key: string; attr_value: string };

export type SuggestionProduct = {
  title: string;
  vendor?: string;
  productType?: string;
  tags?: string[];
};

export type ProductDetailSuggestion = {
  categoryIds: string[];
  rootCategoryId: string | null;
  brandId: string | null;
  attributes: SuggestionAttribute[];
};

const normalize = (value: string) => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLocaleLowerCase("pt-BR")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

const hasTerm = (text: string, terms: string[]) => terms.some((term) =>
  new RegExp(`(^|\\s)${term.replace(/\s+/g, "\\s+")}(?=\\s|$)`).test(text),
);

const DOG_TERMS = ["cao", "caes", "cachorro", "cachorros", "canino", "caninos", "dog", "dogs"];
const CAT_TERMS = ["gato", "gatos", "felino", "felinos", "cat", "cats"];
const FEED_TERMS = ["racao", "racoes", "alimento completo"];
const WET_TERMS = ["umida", "umido", "sache", "pate", "lata"];
const DRY_TERMS = ["seca", "seco", "grao", "graos"];

const ancestorsOf = (categoryId: string, categories: SuggestionCategory[]) => {
  const result: string[] = [];
  const seen = new Set<string>();
  let current = categories.find((category) => category.id === categoryId);
  while (current && !seen.has(current.id)) {
    result.unshift(current.id);
    seen.add(current.id);
    current = current.parent_id
      ? categories.find((category) => category.id === current?.parent_id)
      : undefined;
  }
  return result;
};

export function suggestProductDetails(
  product: SuggestionProduct,
  categories: SuggestionCategory[],
  brands: SuggestionBrand[],
  availableAttributes: SuggestionAttribute[],
): ProductDetailSuggestion {
  const source = normalize([
    product.title,
    product.vendor || "",
    product.productType || "",
    ...(product.tags || []),
  ].join(" "));
  const brandSource = normalize(`${product.vendor || ""} ${product.title}`);
  const isDog = hasTerm(source, DOG_TERMS);
  const isCat = hasTerm(source, CAT_TERMS);
  const isFeed = hasTerm(source, FEED_TERMS);
  const isWet = hasTerm(source, WET_TERMS);
  const isDry = isFeed && !isWet;
  const petTerms = isDog && !isCat ? DOG_TERMS : isCat && !isDog ? CAT_TERMS : [];

  const roots = categories.filter((category) => !category.parent_id);
  const root = petTerms.length
    ? roots.find((category) => hasTerm(normalize(category.name), petTerms)) || null
    : null;

  const belongsToRoot = (category: SuggestionCategory) => (
    !root || ancestorsOf(category.id, categories).includes(root.id)
  );
  const candidates = categories
    .filter((category) => category.id !== root?.id && (root ? belongsToRoot(category) : !category.parent_id))
    .map((category) => {
      const name = normalize(category.name);
      let score = source.includes(name) && name.length >= 3 ? 5 : 0;
      if (isFeed && hasTerm(name, FEED_TERMS)) score += 3;
      if (isDry && hasTerm(name, DRY_TERMS)) score += 5;
      if (isWet && hasTerm(name, WET_TERMS)) score += 5;
      if (isDry && hasTerm(name, WET_TERMS)) score = -1;
      if (isWet && hasTerm(name, DRY_TERMS)) score = -1;
      return { category, score, depth: ancestorsOf(category.id, categories).length };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.depth - a.depth);

  const bestCategory = candidates[0]?.category;
  const categoryIds = bestCategory
    ? ancestorsOf(bestCategory.id, categories)
    : root ? [root.id] : [];

  const brand = [...brands]
    .sort((a, b) => normalize(b.name).length - normalize(a.name).length)
    .find((candidate) => {
      const name = normalize(candidate.name);
      return name.length >= 2 && (` ${brandSource} `).includes(` ${name} `);
    }) || null;

  const attributes = availableAttributes.filter((attribute, index, all) => {
    const key = normalize(attribute.attr_key);
    const value = normalize(attribute.attr_value);
    if (all.findIndex((item) => item.attr_key === attribute.attr_key && item.attr_value === attribute.attr_value) !== index) return false;
    if (value.length >= 3 && (` ${source} `).includes(` ${value} `)) return true;
    if (petTerms.length && (key === "pet" || key.includes("especie")) && hasTerm(value, petTerms)) return true;
    if (isDry && (key === "tipo" || key === "formato") && hasTerm(value, [...DRY_TERMS, "racao seca"])) return true;
    if (isWet && (key === "tipo" || key === "formato") && hasTerm(value, [...WET_TERMS, "racao umida"])) return true;
    return false;
  });

  return {
    categoryIds,
    rootCategoryId: root?.id || null,
    brandId: brand?.id || null,
    attributes,
  };
}
