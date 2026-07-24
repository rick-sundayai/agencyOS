/** Light normalization applied AFTER redaction, before chunking. NFKC is already
 * applied upstream by redactForEmbedding, so it is not repeated here. */
export function formatForEmbedding(text: string): string {
  if (!text) return text;
  return text
    .replace(/[–—]/g, '-')       // en/em dash -> hyphen
    .replace(/[‘’]/g, "'")        // curly single quotes -> '
    .replace(/[“”]/g, '"')        // curly double quotes -> "
    .replace(/[ \t]+$/gm, '')               // strip per-line trailing whitespace
    .replace(/ {2,}/g, ' ')                 // collapse 2+ spaces -> 1
    .replace(/\n{3,}/g, '\n\n')             // collapse 3+ newlines -> paragraph break
    .trim();
}
