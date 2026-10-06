import { allowedDistance, levenshtein, normalizeText } from "@/lib/fuzzySearch";

// Busca da vitrine (barra do topo e pagina do catalogo), com a mesma regra nos dois lugares.
//
// Por que nao e o `fuzzySearch`: aquele aceita o produto quando QUALQUER palavra casa e
// avalia cada campo separado. Em 10/2026, com 714 produtos, "racao gato" devolvia 236
// (toda racao de cachorro junto), "golden gato" trazia "Tunel Y para Gatos" e
// "bravecto 10 a 20kg" trazia "PREM CAT CASTRADO 10KG". Aqui TODA palavra relevante
// precisa casar em algum campo -- titulo, marca, categoria, tags... -- e numero so
// casa com o mesmo numero. O `fuzzySearch` continua servindo as telas do admin.

export interface SearchField {
  value: string | null | undefined;
  /** Peso do campo na relevancia (titulo = 1). */
  weight: number;
}

// "cachorro" nao aparece em nenhum titulo da loja (eles dizem "Caes" ou "Dog"); sem
// sinonimo a busca mais natural do cliente daria zero. Unidades entram aqui porque os
// titulos misturam "200GR", "200 g", "60ML", "5LT".
const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ["cao", "caes", "cachorro", "cachorros", "cachorra", "cachorrinho", "dog", "dogs", "canino", "caninos", "canina"],
  ["gato", "gatos", "gata", "gatas", "gatinho", "gatinhos", "cat", "cats", "felino", "felinos", "felina"],
  ["filhote", "filhotes", "puppy", "kitten"],
  ["adulto", "adultos", "adulta", "adultas", "adult"],
  ["senior", "seniors", "idoso", "idosos"],
  ["castrado", "castrados", "castrada", "castradas"],
  ["antipulga", "antipulgas", "pulga", "pulgas"],
  ["carrapato", "carrapatos", "carrapaticida"],
  ["racao", "racoes"],
  ["petisco", "petiscos", "snack", "snacks"],
  ["sache", "saches", "sachet"],
  ["tapete", "tapetes"],
  ["comprimido", "comprimidos", "comp", "cps"],
  ["capsula", "capsulas", "caps"],
  ["g", "gr", "grama", "gramas"],
  ["kg", "kilo", "kilos", "quilo", "quilos"],
  ["ml", "mililitro", "mililitros"],
  ["l", "lt", "litro", "litros"],
  ["un", "und", "unid", "unidade", "unidades"],
];

const SYNONYMS = new Map<string, ReadonlySet<string>>();
for (const group of SYNONYM_GROUPS) {
  const set = new Set(group);
  group.forEach((word) => SYNONYMS.set(word, set));
}

const STOP_WORDS = new Set([
  "a", "o", "e", "as", "os", "de", "da", "do", "das", "dos", "com", "sem", "em", "no", "na",
  "por", "para", "pra", "pro", "um", "uma", "c", "p",
]);
// "sem" e stop word: "sem graos" vira "graos" e ainda acha o produto certo, enquanto
// exigir "sem" derrubaria os titulos que escrevem "grain free".

const UNIT_WORDS = new Set(["g", "l"]);

/**
 * Palavras do texto, separando numero de letra ("200GR" vira "200" e "gr") e mantendo o
 * decimal inteiro ("10,1 kg" vira "10.1" e "kg"): quebrado, o "1" de "10,1" casava com
 * a busca "premier 1 kg".
 */
export function searchTokens(value: string | null | undefined): string[] {
  if (!value) return [];
  return normalizeText(value)
    .replace(/(\d)[.,](\d)/g, "$1.$2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .match(/\d+(?:\.\d+)*|[a-z0-9]+/g) || [];
}

const isNumber = (word: string) => /^\d+(?:\.\d+)*$/.test(word);

/** Termos que precisam casar. Letra solta so vale quando e unidade (g, l). */
export function relevantTerms(query: string): string[] {
  return searchTokens(query).filter((term) =>
    !STOP_WORDS.has(term) && (term.length > 1 || isNumber(term) || UNIT_WORDS.has(term)));
}

/** Grupo de sinonimos do termo, tolerando erro de digitacao ("cachoro" -> cachorro). */
function synonymGroup(term: string): ReadonlySet<string> | undefined {
  const direct = SYNONYMS.get(term);
  if (direct || term.length < 5) return direct;
  for (const [word, group] of SYNONYMS) {
    if (word.length >= 5 && levenshtein(term, word) <= allowedDistance(term)) return group;
  }
  return undefined;
}

/** Score de 0 a 1 de um termo contra as palavras de um campo. */
function termScore(term: string, words: readonly string[]): number {
  if (isNumber(term)) {
    if (words.includes(term)) return 1;
    // "golden 10kg" ainda acha o saco de 10,1 kg, abaixo do que tem 10 exato.
    return !term.includes(".") && words.some((word) => isNumber(word) && word.split(".")[0] === term) ? 0.85 : 0;
  }
  const group = synonymGroup(term);
  let best = 0;
  for (const word of words) {
    if (word === term) return 1;
    if (isNumber(word)) continue;
    if (group?.has(word)) {
      best = Math.max(best, 0.95);
      continue;
    }
    // Unidade e palavra de 1-2 letras so casam exatas ou por sinonimo.
    if (term.length < 3 || word.length < 3) continue;
    if (word.startsWith(term)) {
      best = Math.max(best, 0.9);
      continue;
    }
    if (term.length >= 4 && word.length >= 4 && term.startsWith(word)) {
      best = Math.max(best, 0.8);
      continue;
    }
    if (term.length >= 4 && word.includes(term)) {
      best = Math.max(best, 0.75);
      continue;
    }
    if (term.length < 4) continue;
    const distance = levenshtein(term, word);
    if (distance <= allowedDistance(term)) {
      best = Math.max(best, 0.7 - distance * 0.1);
      continue;
    }
    // Erro no comeco de palavra ainda sendo digitada: "bravec" -> "bravecto".
    if (term.length >= 5) {
      const headDistance = levenshtein(term, word.slice(0, term.length));
      if (headDistance <= allowedDistance(term)) best = Math.max(best, 0.6 - headDistance * 0.1);
    }
  }
  return best;
}

/** Abaixo disso o termo nao conta como encontrado. */
const MIN_TERM_SCORE = 0.4;

interface PreparedField { words: string[]; weight: number; }

/**
 * Relevancia do item para a busca; 0 quando alguma palavra relevante nao casa em lugar
 * nenhum. O titulo e o primeiro campo da lista e recebe bonus de frase exata.
 */
export function productSearchScore(query: string, fields: readonly SearchField[]): number {
  const terms = relevantTerms(query);
  if (terms.length === 0) return 0;
  const prepared: PreparedField[] = fields
    .filter((field) => field.value)
    .map((field) => ({ words: searchTokens(field.value), weight: field.weight }));
  if (prepared.length === 0) return 0;

  let total = 0;
  let allInTitle = true;
  for (const term of terms) {
    let best = 0;
    prepared.forEach((field, index) => {
      const score = termScore(term, field.words) * field.weight;
      if (score > best) best = score;
      if (index === 0 && score < MIN_TERM_SCORE) allInTitle = false;
    });
    if (best < MIN_TERM_SCORE) return 0;
    total += best;
  }

  let score = total / terms.length;
  if (allInTitle) score += 0.15;
  const title = searchTokens(fields[0]?.value).join(" ");
  const phrase = terms.join(" ");
  if (title.includes(phrase)) score += title.startsWith(phrase) ? 0.3 : 0.2;
  return score;
}

/** Filtra e ordena por relevancia. Busca em branco devolve a lista como veio. */
export function searchProducts<T>(
  query: string,
  items: readonly T[],
  getFields: (item: T) => readonly SearchField[],
): T[] {
  if (relevantTerms(query).length === 0) return [...items];
  return items
    .map((item, index) => ({ item, index, score: productSearchScore(query, getFields(item)) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
}

export interface ProductSearchSource {
  title: string;
  vendor?: string | null;
  productType?: string | null;
  tags?: readonly string[] | null;
  description?: string | null;
  categoryNames?: readonly string[];
  variationGroupName?: string | null;
  variationTexts?: readonly string[];
}

/** Campos e pesos da vitrine, iguais na barra do topo e no catalogo. Titulo primeiro. */
export function productSearchFields(source: ProductSearchSource): SearchField[] {
  return [
    { value: source.title, weight: 1 },
    { value: source.variationGroupName, weight: 1 },
    { value: (source.variationTexts || []).join(" "), weight: 0.95 },
    { value: source.vendor, weight: 0.9 },
    { value: (source.categoryNames || []).join(" "), weight: 0.85 },
    { value: source.productType, weight: 0.85 },
    { value: (source.tags || []).join(" "), weight: 0.8 },
    // Descricao so confirma termo exato ou prefixo; aproximacao nela nao passa do corte.
    { value: source.description?.slice(0, 300), weight: 0.5 },
  ];
}

/**
 * "Voce quis dizer": troca cada termo que nao existe no vocabulario da loja pela
 * palavra mais parecida. Devolve null quando nao ha o que corrigir.
 */
export function suggestSearchCorrection(query: string, vocabulary: ReadonlySet<string>): string | null {
  const terms = relevantTerms(query);
  let changed = false;
  const corrected = terms.map((term) => {
    if (isNumber(term) || term.length < 4 || vocabulary.has(term)) return term;
    const group = synonymGroup(term);
    if (group && [...group].some((word) => vocabulary.has(word))) return term;
    let best: { word: string; distance: number } | null = null;
    for (const word of vocabulary) {
      if (isNumber(word) || Math.abs(word.length - term.length) > 2) continue;
      const distance = levenshtein(term, word);
      if (distance <= allowedDistance(term) + 1 && (!best || distance < best.distance)) best = { word, distance };
    }
    if (!best) return term;
    changed = true;
    return best.word;
  });
  return changed ? corrected.join(" ") : null;
}

/** Vocabulario para `suggestSearchCorrection`, a partir dos mesmos campos da busca. */
export function buildSearchVocabulary(fieldLists: Iterable<readonly SearchField[]>): Set<string> {
  const vocabulary = new Set<string>();
  for (const fields of fieldLists) {
    for (const field of fields) {
      if (field.weight < 0.8) continue;
      searchTokens(field.value).forEach((word) => {
        if (word.length >= 3 && !STOP_WORDS.has(word)) vocabulary.add(word);
      });
    }
  }
  return vocabulary;
}
