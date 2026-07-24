/** Light normalization applied AFTER redaction, before chunking. NFKC is already
 * applied upstream by redactForEmbedding, so it is not repeated here. */
export function formatForEmbedding(text: string): string {
  if (!text) return text;
  return text
    .replace(/[–—]/g, '-')       // en/em dash -> hyphen
    .replace(/['']/g, "'")        // curly single quotes -> '
    .replace(/[""]/g, '"')        // curly double quotes -> "
    .replace(/[ \t]+$/gm, '')               // strip per-line trailing whitespace
    .replace(/ {2,}/g, ' ')                 // collapse 2+ spaces -> 1
    .replace(/\n{3,}/g, '\n\n')             // collapse 3+ newlines -> paragraph break
    .trim();
}

const TARGET = 1500;
const OVERLAP = 200;
const HEADER = '[A-Z][A-Z /&,-]{2,40}';
const SEPARATORS = ['\n\n', '\n', '. ', ' '];

/** Structure-aware chunker: prefers section/paragraph/sentence boundaries and
 * never cuts mid-word under normal input. Empty input -> []. */
export function chunkForEmbedding(text: string): string[] {
  if (!text) return [];
  // Promote ALL-CAPS header lines to paragraph boundaries so a section header
  // prefers to start a new chunk.
  const prepared = text.replace(
    new RegExp(`([^\\n])\\n(${HEADER})(?=\\n)`, 'g'),
    '$1\n\n$2',
  );
  return mergeUnits(recursiveSplit(prepared, SEPARATORS));
}

/** Split text into units each <= TARGET, descending the separator hierarchy only
 * for pieces that are still too big. The separator is re-attached to each piece
 * (except the last) so concatenating units round-trips the original text. */
function recursiveSplit(text: string, seps: string[]): string[] {
  if (text.length <= TARGET) return text ? [text] : [];
  const [sep, ...rest] = seps;
  if (sep === undefined) {
    const out: string[] = [];
    for (let i = 0; i < text.length; i += TARGET) out.push(text.slice(i, i + TARGET));
    return out;
  }
  const parts = text.split(sep);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const piece = i < parts.length - 1 ? parts[i] + sep : parts[i];
    if (!piece) continue;
    if (piece.length <= TARGET) out.push(piece);
    else out.push(...recursiveSplit(piece, rest));
  }
  return out;
}

/** Greedily pack units up to TARGET. On overflow, emit the chunk and carry a
 * word-boundary overlap tail into the next one — except across a paragraph/header
 * boundary (a unit that ended with a blank line), where overlap is dropped so the
 * next section starts clean. */
function mergeUnits(units: string[]): string[] {
  const chunks: string[] = [];
  let cur = '';
  for (const u of units) {
    if (cur && cur.length + u.length > TARGET) {
      chunks.push(cur);
      cur = (cur.endsWith('\n\n') ? '' : tail(cur, OVERLAP)) + u;
    } else {
      cur += u;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/** Last <= n chars of s, trimmed forward to the next word boundary so the overlap
 * never begins mid-word. */
function tail(s: string, n: number): string {
  if (s.length <= n) return s;
  const slice = s.slice(s.length - n);
  const sp = slice.indexOf(' ');
  return sp === -1 ? slice : slice.slice(sp + 1);
}
