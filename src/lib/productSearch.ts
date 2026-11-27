import { levenshtein, normalizeText } from "@/lib/fuzzySearch";

// Busca da vitrine (barra do topo e pagina do catalogo), com a mesma regra nos dois lugares.
//
// Por que nao e o `fuzzySearch`: aquele aceita o produto quando QUALQUER palavra casa e
// avalia cada campo separado. Em 10/2026, com 714 produtos, "racao gato" devolvia 236
// (toda racao de cachorro junto), "golden gato" trazia "Tunel Y para Gatos" e
// "bravecto 10 a 20kg" trazia "PREM CAT CASTRADO 10KG". Aqui TODA palavra relevante
// precisa casar em algum campo -- titulo, marca, categoria, tags... -- e numero so
// casa com o mesmo numero. O `fuzzySearch` continua servindo as telas do admin.
//
// Em 11/2026 (573 produtos a venda) a tolerancia a erro ainda trazia lixo quando a loja
// nao tinha o produto: "coleira" -> Fator Colica, "cama" -> Capa Pet, "drontal" -> Snack
// Dental, "omega" -> Golden Mega. Por isso o casamento tem dois niveis: forte (exato,
// sinonimo, prefixo) e aproximado (erro de digitacao, so a descricao). O aproximado so
// aparece quando nenhum produto casa forte.

export interface SearchField {
  value: string | null | undefined;
  /** Peso do campo na relevancia (titulo = 1). */
  weight: number;
  /** Campo que so confirma: casar so nele conta como aproximado (ex.: descricao). */
  supportOnly?: boolean;
}

// "cachorro" nao aparece em nenhum titulo da loja (eles dizem "Caes" ou "Dog"); sem
// sinonimo a busca mais natural do cliente daria zero. Unidades entram aqui porque os
// titulos misturam "200GR", "200 g", "60ML", "5LT". Vale nos dois sentidos.
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
  ["suplemento", "suplementos", "vitamina", "vitaminas", "polivitaminico"],
  ["comprimido", "comprimidos", "comp", "cps"],
  ["capsula", "capsulas", "caps"],
  ["g", "gr", "grama", "gramas"],
  ["kg", "kilo", "kilos", "quilo", "quilos"],
  ["ml", "mililitro", "mililitros"],
  ["l", "lt", "litro", "litros"],
  ["un", "und", "unid", "unidade", "unidades"],
];

// Palavra do cliente -> como a loja chama. So num sentido: quem busca "sache" quer
// sache, mas quem busca "racao umida" aceita sache e lata. Medido em 11/2026:
// "vermifugo" dava 0 com 10 "Antiparasitario" a venda; "brinquedo" achava 2 e nao os
// mordedores; "areia sanitaria" dava 0 com as areias de silica.
const QUERY_EXPANSIONS: readonly [readonly string[], readonly string[]][] = [
  [["vermifugo", "vermifugos", "verme", "vermes"], ["antiparasitario", "antiparasitarios", "vermifugo", "vermifugos"]],
  [["remedio", "remedios"], ["medicamento", "medicamentos", "farmacia"]],
  [["brinquedo", "brinquedos"], ["mordedor", "mordedores", "bolinha", "bolinhas", "bola", "bolas", "pelucia"]],
  [["umida", "umido", "umidas", "umidos"], ["sache", "saches", "sachet", "lata", "latas", "pate", "pates"]],
  [["pate", "pates"], ["sache", "saches", "sachet", "lata", "latas", "umida", "umido"]],
  [["sanitaria", "sanitarias", "sanitario", "sanitarios"], ["areia", "areias", "silica", "granulado", "banheiro", "banheiros"]],
  [["dermatite", "dermatologico", "dermatologica", "alergia", "alergico"], ["dermatologico", "dermatologica", "dermatite", "hipoalergenico", "hipoalergenica", "terapeutico"]],
];

// "racao umida" vira "umida": os saches e latas nao dizem "racao" no titulo.
const MAKES_RACAO_IMPLICIT = new Set(["umida", "umido", "umidas", "umidos", "pate", "pates", "sache", "saches", "lata", "latas"]);

const SYNONYMS = new Map<string, ReadonlySet<string>>();
for (const group of SYNONYM_GROUPS) {
  const set = new Set(group);
  group.forEach((word) => SYNONYMS.set(word, set));
}

const EXPANSIONS = new Map<string, ReadonlySet<string>>();
for (const [keys, words] of QUERY_EXPANSIONS) {
  const set = new Set(words);
  keys.forEach((key) => EXPANSIONS.set(key, set));
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

/** `relevantTerms` sem as palavras que outra ja implica ("racao" em "racao umida"). */
function queryTerms(query: string): string[] {
  const terms = relevantTerms(query);
  if (!terms.some((term) => MAKES_RACAO_IMPLICIT.has(term))) return terms;
  const rest = terms.filter((term) => term !== "racao" && term !== "racoes");
  return rest.length > 0 ? rest : terms;
}

/**
 * Erros de digitacao aceitos. Palavra de ate 4 letras nao aceita nenhum: "cama" casava
 * com "capa" e "lata" com "cata". Bem mais rigido que o `allowedDistance` do admin.
 */
const typoTolerance = (term: string) => (term.length <= 4 ? 0 : term.length <= 7 ? 1 : 2);

/** Distancia de edicao contando letra trocada de lugar como um erro so ("bravceto"). */
export function typoDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 3) return levenshtein(a, b);
  const rows: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, rows[i - 2][j - 2] + 1);
      }
      rows[i][j] = value;
    }
  }
  return rows[a.length][b.length];
}

/** Grupo de sinonimos do termo, tolerando erro de digitacao ("cachoro" -> cachorro). */
function synonymGroup(term: string): ReadonlySet<string> | undefined {
  const direct = SYNONYMS.get(term);
  if (direct || term.length < 5) return direct;
  const tolerance = typoTolerance(term);
  for (const [word, group] of SYNONYMS) {
    if (word.length >= 5 && typoDistance(term, word) <= tolerance) return group;
  }
  return undefined;
}

/** A partir deste score o termo casou "forte" (exato, sinonimo, prefixo). */
const STRONG_TERM_SCORE = 0.75;

/** Score de 0 a 1 de um termo contra as palavras de um campo. */
function termScore(term: string, words: readonly string[]): number {
  if (isNumber(term)) {
    if (words.includes(term)) return 1;
    // "golden 10kg" ainda acha o saco de 10,1 kg, abaixo do que tem 10 exato.
    return !term.includes(".") && words.some((word) => isNumber(word) && word.split(".")[0] === term) ? 0.85 : 0;
  }
  const group = synonymGroup(term);
  const expansion = EXPANSIONS.get(term);
  const tolerance = typoTolerance(term);
  let best = 0;
  for (const word of words) {
    if (word === term) return 1;
    if (isNumber(word)) continue;
    if (group?.has(word)) {
      best = Math.max(best, 0.95);
      continue;
    }
    if (expansion?.has(word)) {
      best = Math.max(best, 0.9);
      continue;
    }
    // Unidade e palavra de 1-2 letras so casam exatas ou por sinonimo.
    if (term.length < 3 || word.length < 3) continue;
    if (word.startsWith(term)) {
      best = Math.max(best, 0.9);
      continue;
    }
    // "antipulgas" acha "antipulga"; muito mais curta ("omega" -> "ome") e aproximado.
    if (term.length >= 4 && word.length >= 4 && term.startsWith(word)) {
      best = Math.max(best, term.length - word.length <= 2 ? 0.8 : 0.5);
      continue;
    }
    if (term.length >= 5 && word.includes(term)) {
      best = Math.max(best, 0.75);
      continue;
    }
    if (tolerance === 0 || word.length < 4) continue;
    const distance = typoDistance(term, word);
    if (distance <= tolerance) {
      best = Math.max(best, 0.7 - distance * 0.1);
      continue;
    }
    // Erro no comeco de palavra ainda sendo digitada: "bravec" -> "bravecto".
    if (word.length > term.length) {
      const headDistance = typoDistance(term, word.slice(0, term.length));
      if (headDistance <= tolerance) best = Math.max(best, 0.6 - headDistance * 0.1);
    }
  }
  return best;
}

/** Abaixo disso o termo nao conta como encontrado. */
const MIN_TERM_SCORE = 0.4;

interface PreparedField { words: string[]; weight: number; supportOnly: boolean; isTitle: boolean; }
interface PreparedItem { fields: PreparedField[]; title: string; }

function prepareItem(fields: readonly SearchField[]): PreparedItem {
  return {
    fields: fields
      .map((field, index) => ({
        words: searchTokens(field.value),
        weight: field.weight,
        supportOnly: !!field.supportOnly,
        isTitle: index === 0,
      }))
      .filter((field) => field.words.length > 0),
    title: searchTokens(fields[0]?.value).join(" "),
  };
}

interface TermMatch { score: number; strong: boolean; inTitle: boolean; }

function matchTerm(term: string, item: PreparedItem): TermMatch {
  let score = 0;
  let strong = false;
  let inTitle = false;
  for (const field of item.fields) {
    const raw = termScore(term, field.words);
    const weighted = raw * field.weight;
    if (weighted > score) score = weighted;
    if (weighted >= MIN_TERM_SCORE && raw >= STRONG_TERM_SCORE && !field.supportOnly) strong = true;
    if (field.isTitle && weighted >= MIN_TERM_SCORE) inTitle = true;
  }
  return { score, strong, inTitle };
}

interface ItemScore { score: number; strong: boolean; }

function scoreItem(terms: readonly string[], item: PreparedItem): ItemScore {
  if (terms.length === 0 || item.fields.length === 0) return { score: 0, strong: false };
  let total = 0;
  let strong = true;
  let allInTitle = true;
  for (const term of terms) {
    const match = matchTerm(term, item);
    if (match.score < MIN_TERM_SCORE) return { score: 0, strong: false };
    total += match.score;
    strong &&= match.strong;
    allInTitle &&= match.inTitle;
  }
  let score = total / terms.length;
  if (allInTitle) score += 0.15;
  const phrase = terms.join(" ");
  if (item.title.includes(phrase)) score += item.title.startsWith(phrase) ? 0.3 : 0.2;
  return { score, strong };
}

/**
 * Relevancia do item para a busca; 0 quando alguma palavra relevante nao casa em lugar
 * nenhum. O titulo e o primeiro campo da lista e recebe bonus de frase exata.
 */
export function productSearchScore(query: string, fields: readonly SearchField[]): number {
  return scoreItem(queryTerms(query), prepareItem(fields)).score;
}

export interface ProductSearchResult<T> {
  items: T[];
  /** Palavras que nao existem em produto nenhum e foram deixadas de fora. */
  ignoredTerms: string[];
  /** So ha resultados por aproximacao (erro de digitacao, descricao). */
  approximate: boolean;
}

function rank<T>(terms: readonly string[], items: readonly T[], prepared: readonly PreparedItem[]) {
  const scored = items
    .map((item, index) => ({ item, index, ...scoreItem(terms, prepared[index]) }))
    .filter((entry) => entry.score > 0);
  // Com algum resultado forte, os aproximados viram ruido ("omega" -> Golden Mega).
  const hasStrong = scored.some((entry) => entry.strong);
  return {
    items: scored
      .filter((entry) => !hasStrong || entry.strong)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map((entry) => entry.item),
    approximate: scored.length > 0 && !hasStrong,
  };
}

/**
 * Filtra e ordena por relevancia. Quando nenhum produto tem todas as palavras e
 * alguma delas nao existe na loja ("areia xyz"), busca sem ela e avisa em
 * `ignoredTerms`. Busca em branco devolve a lista como veio.
 */
export function searchProductsDetailed<T>(
  query: string,
  items: readonly T[],
  getFields: (item: T) => readonly SearchField[],
): ProductSearchResult<T> {
  const terms = queryTerms(query);
  if (terms.length === 0) return { items: [...items], ignoredTerms: [], approximate: false };
  const prepared = items.map((item) => prepareItem(getFields(item)));
  const full = rank(terms, items, prepared);
  if (full.items.length > 0 || terms.length < 2) return { ...full, ignoredTerms: [] };

  const found = terms.filter((term) => prepared.some((item) => matchTerm(term, item).score >= MIN_TERM_SCORE));
  if (found.length === 0 || found.length === terms.length) return { ...full, ignoredTerms: [] };
  return { ...rank(found, items, prepared), ignoredTerms: terms.filter((term) => !found.includes(term)) };
}

export function searchProducts<T>(
  query: string,
  items: readonly T[],
  getFields: (item: T) => readonly SearchField[],
): T[] {
  return searchProductsDetailed(query, items, getFields).items;
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
    // Descricao so confirma: "remedio" no texto de uma racao nao faz dela um remedio.
    { value: source.description?.slice(0, 300), weight: 0.5, supportOnly: true },
  ];
}

/**
 * "Voce quis dizer": troca cada termo que nao existe no vocabulario da loja pela
 * palavra mais parecida -- mesma letra inicial e poucos erros, para nao sugerir
 * "protein" para "frontline" nem "apso" para "osso". Devolve null quando nao ha o que
 * corrigir. Quem mostra a sugestao deve conferir que ela acha produto.
 */
export function suggestSearchCorrection(query: string, vocabulary: ReadonlySet<string>): string | null {
  const terms = relevantTerms(query);
  let changed = false;
  const corrected = terms.map((term) => {
    if (isNumber(term) || term.length < 4 || vocabulary.has(term)) return term;
    const group = synonymGroup(term);
    if (group && [...group].some((word) => vocabulary.has(word))) return term;
    const expansion = EXPANSIONS.get(term);
    if (expansion && [...expansion].some((word) => vocabulary.has(word))) return term;
    // Dois erros so em palavra longa: "coleira" -> "colica", "drontal" -> "dental".
    const maxDistance = term.length <= 7 ? 1 : 2;
    let best: { word: string; distance: number } | null = null;
    for (const word of vocabulary) {
      if (isNumber(word) || word[0] !== term[0] || Math.abs(word.length - term.length) > 2) continue;
      const distance = typoDistance(term, word);
      if (distance <= maxDistance && (!best || distance < best.distance)) best = { word, distance };
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
