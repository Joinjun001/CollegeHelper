const ENTITY_MAP: Readonly<Record<string, string>> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

export function htmlToPlainText(value: string | null | undefined, maxLength = 8_000): string | null {
  if (!value) return null;

  const withoutUnsafeBlocks = value
    .replace(/<\s*(script|style|iframe|object|embed)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, " ")
    .replace(/<\s*(br|\/p|\/div|\/li|\/tr|\/h[1-6])\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ");
  const decoded = withoutUnsafeBlocks.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    const normalized = entity.toLowerCase();
    if (normalized.startsWith("#x")) return safeCodePoint(Number.parseInt(normalized.slice(2), 16), match);
    if (normalized.startsWith("#")) return safeCodePoint(Number.parseInt(normalized.slice(1), 10), match);
    return ENTITY_MAP[normalized] ?? match;
  });
  const normalized = decoded
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!normalized) return null;
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}…`;
}

function safeCodePoint(value: number, fallback: string): string {
  if (!Number.isInteger(value) || value < 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) return fallback;
  return String.fromCodePoint(value);
}
