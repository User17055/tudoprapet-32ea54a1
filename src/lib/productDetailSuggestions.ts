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
const NATURAL_FEED_TERMS = ["natural", "naturais", "alimentacao natural", "comida natural"];
const PRESCRIPTION_FEED_TERMS = [
  "prescrita",
  "prescritas",
  "prescrito",
  "prescritos",
  "prescricao",
  "terapeutica",
  "terapeutico",
  "dieta veterinaria",
  "nutricao clinica",
  "prescription diet",
  "veterinary diet",
];
const PUPPY_TERMS = ["filhote", "filhotes", "filh", "puppy", "puppies", "junior"];
const ADULT_TERMS = ["adulto", "adultos", "adult", "ad"];
const SENIOR_TERMS = ["senior", "idoso", "idosos", "maduro", "maduros"];
const SMALL_TERMS = ["raca pequena", "racas pequenas", "porte pequeno", "portes pequenos", "pequena", "pequenas", "pequeno", "pequenos", "peq", "mini", "small"];
const MEDIUM_TERMS = ["raca media", "racas medias", "porte medio", "portes medios", "media", "medias", "medio", "medios", "medium"];
const LARGE_TERMS = ["raca grande", "racas grandes", "porte grande", "portes grandes", "grande", "grandes", "large"];
const GIANT_TERMS = ["raca gigante", "racas gigantes", "porte gigante", "portes gigantes", "gigante", "gigantes", "giant"];
const TREAT_TERMS = ["cookie", "cookies", "biscoito", "biscoitos", "petisco", "petiscos", "snack", "snacks"];
const SUPPLEMENT_TERMS = ["probiotico", "prebiotico", "suplemento", "suplementos", "vitamina", "vitaminas"];
const ALL_SIZE_TERMS = [
  ...SMALL_TERMS,
  ...MEDIUM_TERMS,
  ...LARGE_TERMS,
  ...GIANT_TERMS,
  "todos",
  "todos os portes",
  "todos os tamanhos",
];

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
  // Cookies da linha pet sao produtos caninos. Os titulos abreviados vindos do
  // ERP (ex.: "COOKIE AD RC PEQ") nao trazem a palavra "caes".
  const isTreat = hasTerm(source, TREAT_TERMS);
  const isDog = hasTerm(source, DOG_TERMS) || hasTerm(source, ["cookie", "cookies"]);
  const isCat = hasTerm(source, CAT_TERMS);
  const hasFeedTerm = hasTerm(source, FEED_TERMS);
  const isNattu = hasTerm(source, ["nattu"]);
  const isClinicalNutrition = hasTerm(source, ["nutricao clinica"]);
  const isPrescriptionFeed = isClinicalNutrition
    || hasTerm(source, ["dieta veterinaria", "prescription diet", "veterinary diet"])
    || (hasFeedTerm && hasTerm(source, PRESCRIPTION_FEED_TERMS));
  const isFeed = hasFeedTerm || isNattu || isPrescriptionFeed;
  const isNaturalFeed = isNattu || (isFeed && hasTerm(source, NATURAL_FEED_TERMS));
  const isWet = hasTerm(source, WET_TERMS);
  const isDry = isFeed && !isWet && !isNaturalFeed && !isPrescriptionFeed;
  const isPuppy = hasTerm(source, PUPPY_TERMS);
  const isAdult = hasTerm(source, ADULT_TERMS);
  const isSenior = hasTerm(source, SENIOR_TERMS);
  const isSmall = hasTerm(source, SMALL_TERMS);
  const isMedium = hasTerm(source, MEDIUM_TERMS);
  const isLarge = hasTerm(source, LARGE_TERMS);
  const isGiant = hasTerm(source, GIANT_TERMS);
  const isSupplement = hasTerm(source, SUPPLEMENT_TERMS);

  const roots = categories.filter((category) => !category.parent_id);
  const matchingRoots = roots.filter((category) => {
    const name = normalize(category.name);
    return (isDog && hasTerm(name, DOG_TERMS)) || (isCat && hasTerm(name, CAT_TERMS));
  });
  const scoreCategory = (category: SuggestionCategory) => {
      const name = normalize(category.name);
      let score = source.includes(name) && name.length >= 3 ? 5 : 0;
      if (isFeed && hasTerm(name, FEED_TERMS)) score += 3;
      if (isTreat && hasTerm(name, ["petisco", "petiscos"])) score += 8;
      if (isSupplement && hasTerm(name, ["suplemento", "suplementos", "vitamina", "vitaminas"])) score += 8;
      if (isNaturalFeed && hasTerm(name, NATURAL_FEED_TERMS)) score += 8;
      if (isPrescriptionFeed && hasTerm(name, PRESCRIPTION_FEED_TERMS)) score += 8;
      if (isDry && hasTerm(name, DRY_TERMS)) score += 5;
      if (isWet && hasTerm(name, WET_TERMS)) score += 5;
      if (isDry && hasTerm(name, WET_TERMS)) score = -1;
      if (isWet && hasTerm(name, DRY_TERMS)) score = -1;
      if ((isNaturalFeed || isPrescriptionFeed) && hasTerm(name, DRY_TERMS)) score = -1;
      return { category, score, depth: ancestorsOf(category.id, categories).length };
  };
  const bestPathForRoot = (root: SuggestionCategory) => {
    const bestCategory = categories
      .filter((category) => category.id !== root.id && ancestorsOf(category.id, categories).includes(root.id))
      .map(scoreCategory)
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.depth - a.depth)[0]?.category;
    return bestCategory ? ancestorsOf(bestCategory.id, categories) : [root.id];
  };
  const categoryIds = Array.from(new Set(matchingRoots.flatMap(bestPathForRoot)));
  const root = matchingRoots.length === 1 ? matchingRoots[0] : null;

  const brand = [...brands]
    .sort((a, b) => normalize(b.name).length - normalize(a.name).length)
    .find((candidate) => {
      const name = normalize(candidate.name);
      return name.length >= 2 && (` ${brandSource} `).includes(` ${name} `);
    }) || null;

  const attributes = availableAttributes.filter((attribute, index, all) => {
    const key = normalize(attribute.attr_key);
    const value = normalize(attribute.attr_value);
    const isAgeKey = key === "idade" || key.includes("idade") || key.includes("fase");
    const isSizeKey = key === "raca" || key === "porte" || key.includes("raca") || key.includes("porte") || key.includes("tamanho");
    const isTypeKey = key === "tipo" || key.includes("tipo");
    const isFoodClassificationKey = isTypeKey || key.includes("categoria") || key.includes("classificacao");
    const isFoodFormatKey = key === "formato" || key.includes("formato");
    if (all.findIndex((item) => item.attr_key === attribute.attr_key && item.attr_value === attribute.attr_value) !== index) return false;
    // Toda ração que não for úmida usa o formato Grãos, mesmo quando o título
    // não diz explicitamente "seca" ou "grãos". Para ração úmida, nunca force
    // Grãos; use somente um formato úmido que esteja cadastrado.
    if (isFoodFormatKey && isFeed) {
      return isWet
        ? WET_TERMS.some((term) => hasTerm(source, [term]) && hasTerm(value, [term]))
        : hasTerm(value, ["grao", "graos"]);
    }
    if (isFoodFormatKey && isTreat) {
      if (hasTerm(source, ["cookie", "cookies", "biscoito", "biscoitos"])) {
        return hasTerm(value, ["biscoito", "biscoitos"]);
      }
    }
    if (value.length >= 3 && (` ${source} `).includes(` ${value} `)) return true;
    if (key === "pet" || key.includes("especie")) {
      return (isDog && hasTerm(value, DOG_TERMS)) || (isCat && hasTerm(value, CAT_TERMS));
    }
    if (isNaturalFeed && isFoodClassificationKey && hasTerm(value, NATURAL_FEED_TERMS)) return true;
    if (isPrescriptionFeed && isFoodClassificationKey && hasTerm(value, PRESCRIPTION_FEED_TERMS)) return true;
    if (isDry && isTypeKey && hasTerm(value, [...DRY_TERMS, "racao seca"])) return true;
    if (isWet && (isTypeKey || isFoodFormatKey) && hasTerm(value, [...WET_TERMS, "racao umida"])) return true;
    if (isAgeKey && isPuppy && hasTerm(value, PUPPY_TERMS)) return true;
    if (isAgeKey && isAdult && hasTerm(value, ADULT_TERMS)) return true;
    if (isAgeKey && isSenior && hasTerm(value, SENIOR_TERMS)) return true;
    if (isFeed && isAgeKey && !isPuppy && !isAdult && !isSenior) return true;
    if (isSizeKey && isSmall && hasTerm(value, ["pequena", "pequeno", "mini", "small"])) return true;
    if (isSizeKey && isMedium && hasTerm(value, ["media", "medio", "medium"])) return true;
    if (isSizeKey && isLarge && hasTerm(value, ["grande", "large"])) return true;
    if (isSizeKey && isGiant && hasTerm(value, ["gigante", "giant"])) return true;
    if (isFeed && isSizeKey && !isSmall && !isMedium && !isLarge && !isGiant && hasTerm(value, ALL_SIZE_TERMS)) return true;
    return false;
  });

  return {
    categoryIds,
    rootCategoryId: root?.id || null,
    brandId: brand?.id || null,
    attributes,
  };
}
