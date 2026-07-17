// TS twins of n8n/workflows/src/helpers.js chunkText/sha256 — keep in sync so
// backfilled chunks match what the Data Steward workflow produces at runtime.
import { createHash } from 'node:crypto';

export const chunkText = (text: string, size = 1500, overlap = 200): string[] => {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size - overlap) {
    out.push(text.slice(i, i + size));
    if (i + size >= text.length) break;
  }
  return out;
};

export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
