const UNIT = "kg|mg|g|ml|l";
const RANGE = new RegExp(`\\b(\\d+(?:[.,]\\d+)?)\\s*(?:a|até|-)\\s*(\\d+(?:[.,]\\d+)?)\\s*(${UNIT})\\b`, "gi");
const MEASUREMENT = new RegExp(`\\b(\\d+(?:[.,]\\d+)?)\\s*(${UNIT})\\b`, "gi");

/** Apresentação curta para os cards, inclusive quando não há grupo de variações. */
export function productPackageLabel(...sources: Array<string | null | undefined>): string | null {
  for (const source of sources) {
    if (!source) continue;
    const ranges = [...source.matchAll(RANGE)];
    if (ranges.length) {
      const [, first, last, unit] = ranges.at(-1)!;
      return `${first.replace(".", ",")} a ${last.replace(".", ",")} ${unit.toLowerCase()}`;
    }
    const matches = [...source.matchAll(MEASUREMENT)];
    if (matches.length) {
      const [, amount, unit] = matches.at(-1)!;
      return `${amount.replace(".", ",")} ${unit.toLowerCase()}`;
    }
  }
  return null;
}
