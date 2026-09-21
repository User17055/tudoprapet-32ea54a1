import { normalizeText } from "@/lib/fuzzySearch";

export interface DuplicateCandidate {
  id: string;
  title: string;
  handle: string;
  sku?: string | null;
  imageUrl?: string | null;
}

export interface DuplicatePair {
  first: DuplicateCandidate;
  second: DuplicateCandidate;
  score: number;
  reason: "sku" | "same_name" | "similar_name";
}

const STOP_WORDS = new Set(["a", "as", "o", "os", "de", "da", "das", "do", "dos", "e", "em", "para", "por", "com"]);

function canonicalTitle(title: string) {
  return normalizeText(title)
    .replace(/(\d+(?:[.,]\d+)?)\s*(kg|g|mg|l|ml)\b/g, (_, raw: string, unit: string) => {
      const value = Number(raw.replace(",", "."));
      const base = unit === "kg" || unit === "l" ? value * 1000 : unit === "mg" ? value / 1000 : value;
      return ` ${unit === "l" || unit === "ml" ? "volume" : "peso"}${Number(base.toFixed(3))} `;
    })
    .replace(/[^a-z0-9.]+/g, " ")
    .split(/\s+/)
    .filter((token) => token && !STOP_WORDS.has(token));
}

function editDistanceAtMostOne(a: string, b: string) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 5) return false;
  let i = 0;
  let j = 0;
  let changes = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++changes > 1) return false;
    if (a.length >= b.length) i++;
    if (b.length >= a.length) j++;
  }
  return changes + Number(i < a.length || j < b.length) <= 1;
}

function similarity(firstTitle: string, secondTitle: string) {
  const first = canonicalTitle(firstTitle);
  const second = canonicalTitle(secondTitle);
  // A apresentação/dosagem precisa coincidir; nunca sugerir 1 kg como 10 kg.
  const numbers = (tokens: string[]) => tokens.filter((token) => /\d/.test(token)).sort().join("|");
  if (numbers(first) !== numbers(second)) return 0;
  const a = first.filter((token) => !/\d/.test(token));
  const b = second.filter((token) => !/\d/.test(token));
  if (!a.length || !b.length) return 0;
  const remaining = [...b];
  let matched = 0;
  for (const token of a) {
    const exact = remaining.indexOf(token);
    const index = exact >= 0 ? exact : remaining.findIndex((other) => editDistanceAtMostOne(token, other));
    if (index >= 0) { matched++; remaining.splice(index, 1); }
  }
  return matched / Math.max(a.length, b.length);
}

export function findPossibleDuplicates(products: DuplicateCandidate[]): DuplicatePair[] {
  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < products.length; i++) {
    for (let j = i + 1; j < products.length; j++) {
      const first = products[i];
      const second = products[j];
      if (first.id === second.id) continue;
      const score = similarity(first.title, second.title);
      if (score < 0.85) continue;
      const sameSku = !!first.sku?.trim() && first.sku.trim().toLowerCase() === second.sku?.trim().toLowerCase();
      pairs.push({
        first,
        second,
        score,
        reason: sameSku ? "sku" : score === 1 ? "same_name" : "similar_name",
      });
    }
  }
  return pairs.sort((a, b) => b.score - a.score || a.first.title.localeCompare(b.first.title, "pt-BR"));
}
