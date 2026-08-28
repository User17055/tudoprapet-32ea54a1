import { fuzzyMatchScore, normalizeText } from "@/lib/fuzzySearch";

const MEASUREMENT_PATTERN = /\b\d+(?:[.,]\d+)?\s*(?:kg|g|mg|ml|l|un(?:id(?:ade)?s?)?)\b/gi;
const IGNORED_WORDS = new Set(["para", "de", "da", "do", "com", "e", "a", "o", "em", "por"]);

/** Retira peso/volume do título para comparar o nome real do produto. */
export function variationBaseName(title: string): string {
  return normalizeText(title)
    .replace(MEASUREMENT_PATTERN, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Retorna de 0 a 1. Exige que a maior parte das palavras relevantes coincida,
 * evitando sugerir produtos diferentes apenas porque ambos contêm "ração".
 */
export function productVariationSimilarity(referenceTitle: string, candidateTitle: string): number {
  const reference = variationBaseName(referenceTitle);
  const candidate = variationBaseName(candidateTitle);
  if (!reference || !candidate) return 0;
  if (reference === candidate) return 1;

  const tokens = (value: string) => value
    .split(" ")
    .filter((token) => token.length > 1 && !IGNORED_WORDS.has(token));
  const referenceTokens = tokens(reference);
  const candidateTokens = tokens(candidate);
  if (referenceTokens.length < 2 || candidateTokens.length < 2) return 0;

  const candidateSet = new Set(candidateTokens);
  const common = referenceTokens.filter((token) => candidateSet.has(token)).length;
  const coverage = common / Math.max(referenceTokens.length, candidateTokens.length);
  if (common < 2 || coverage < 0.6) return 0;

  return Math.min(1, coverage * 0.7 + fuzzyMatchScore(reference, candidate) * 0.3);
}
