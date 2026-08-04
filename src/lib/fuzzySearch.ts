/**
 * Busca tolerante a erros de digitacao.
 * Compara os termos digitados com o texto do produto usando prefixo,
 * substring e distancia de edicao (Levenshtein), retornando um score.
 * Termos muito distantes (ex: "jdkamkeasld") ficam de fora.
 */

export const normalizeText = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const tokenize = (value: string) => normalizeText(value).match(/[a-z0-9]+/g) || [];

const STOP_WORDS = new Set(["para", "de", "da", "do", "com", "e", "a", "o", "em", "por"]);

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = curr;
  }
  return prev[b.length];
}

/** Tolerancia de erros de acordo com o tamanho da palavra. */
const allowedDistance = (word: string) => {
  if (word.length <= 3) return 0;
  if (word.length <= 5) return 1;
  if (word.length <= 8) return 2;
  return 3;
};

/** Tamanho minimo para uma palavra do texto valer casamento por prefixo/substring. */
const MIN_LOOSE_MATCH_LENGTH = 3;

/**
 * Palavras curtas ou vazias de significado nao podem casar por prefixo/substring:
 * "de" e substring de "golden", o que fazia qualquer titulo com "de" casar com
 * a busca "golden". Casamento exato continua valendo para qualquer palavra.
 */
const allowsLooseMatch = (word: string) =>
  word.length >= MIN_LOOSE_MATCH_LENGTH && !STOP_WORDS.has(word);

/** Score de 0 a 1 de um termo contra as palavras do texto (0 = nao casou). */
function tokenScore(term: string, words: string[]): number {
  let best = 0;
  for (const word of words) {
    if (word === term) return 1;
    if (allowsLooseMatch(word)) {
      if (word.startsWith(term) || term.startsWith(word)) {
        best = Math.max(best, 0.9);
        continue;
      }
      if (word.includes(term) || term.includes(word)) {
        best = Math.max(best, 0.75);
        continue;
      }
    }
    const dist = levenshtein(term, word);
    if (dist <= allowedDistance(term)) {
      best = Math.max(best, 0.7 - dist * 0.1);
      continue;
    }
    // erro de digitacao no comeco da palavra (ex: "raçao pemium")
    const head = word.slice(0, term.length);
    const headDist = levenshtein(term, head);
    if (term.length >= 4 && headDist <= allowedDistance(term)) {
      best = Math.max(best, 0.6 - headDist * 0.1);
    }
  }
  return best;
}

/**
 * Score do texto para a busca. Retorna 0 quando nada relevante casa.
 */
export function fuzzyMatchScore(query: string, text: string): number {
  const terms = tokenize(query).filter((t) => t.length > 1);
  if (terms.length === 0) return 0;
  const words = tokenize(text);
  if (words.length === 0) return 0;

  const normalizedText = normalizeText(text);
  const normalizedQuery = normalizeText(query);
  if (normalizedText.includes(normalizedQuery)) return 1;

  let total = 0;
  let matched = 0;
  for (const term of terms) {
    const score = tokenScore(term, words);
    if (score > 0) matched++;
    else if (!STOP_WORDS.has(term)) total -= 0.15;
    total += score;
  }

  // exige que ao menos um termo relevante case de verdade
  const relevantTerms = terms.filter((t) => !STOP_WORDS.has(t));
  if (matched === 0) return 0;
  if (relevantTerms.length > 0 && matched === 0) return 0;

  const score = total / terms.length;
  return score > 0.35 ? Math.min(score, 1) : 0;
}

export interface FuzzyField {
  value: string | null | undefined;
  weight?: number;
}

/** Score considerando varios campos (titulo, marca, tags...). */
export function fuzzyScoreFields(query: string, fields: FuzzyField[]): number {
  let best = 0;
  for (const field of fields) {
    if (!field.value) continue;
    const score = fuzzyMatchScore(query, field.value) * (field.weight ?? 1);
    if (score > best) best = score;
  }
  return best;
}

/**
 * Filtra e ordena itens por relevancia fuzzy.
 */
export function fuzzySearch<T>(
  query: string,
  items: T[],
  getFields: (item: T) => FuzzyField[],
): T[] {
  if (!query.trim()) return items;
  return items
    .map((item) => ({ item, score: fuzzyScoreFields(query, getFields(item)) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item);
}
