const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(?:\+1[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}/g;
const URL_RE = /(?:https?:\/\/|www\.)\S+/gi;

const PRONOUN_MAP: Record<string, string> = {
  she: 'they', he: 'they',
  her: 'their', his: 'their',
  him: 'them', hers: 'theirs',
  herself: 'themself', himself: 'themself',
};
const PRONOUN_RE = new RegExp(`\\b(${Object.keys(PRONOUN_MAP).join('|')})\\b`, 'gi');

export function redactForEmbedding(text: string | null): string | null {
  if (!text) return text;
  return text.normalize('NFKC')
    .replace(EMAIL_RE, '[EMAIL]')
    .replace(PHONE_RE, '[PHONE]')
    .replace(URL_RE, '');
}

export function redactForLLM(text: string | null, fullName: string): string | null {
  if (!text) return text;
  let out = redactForEmbedding(text)!;
  for (const token of fullName.split(/\s+/).filter((t) => t.length >= 2)) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Not \b: a token ending in punctuation (e.g. "St.") sits between two non-word
    // characters when followed by a space, so \b never fires there and the match is
    // silently skipped. Alphanumeric-adjacency lookarounds keep whole-word semantics
    // without that gap.
    out = out.replace(new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'gi'), '[NAME]');
  }
  out = out.replace(/(\[NAME\]\s*)+\[NAME\]/g, '[NAME]');
  out = out.replace(PRONOUN_RE, (match) => {
    const replacement = PRONOUN_MAP[match.toLowerCase()];
    return match[0] === match[0].toUpperCase()
      ? replacement[0].toUpperCase() + replacement.slice(1)
      : replacement;
  });
  return out;
}
