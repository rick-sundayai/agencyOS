import { describe, it, expect } from 'vitest';
import {
  extractResumeText, UnsupportedResumeError, EmptyResumeError, type Parsers,
} from './resume-extract';

const bytes = new Uint8Array([1, 2, 3]);
const fakeParsers: Parsers = {
  pdf: async () => 'PDF RESUME TEXT',
  docx: async () => 'DOCX RESUME TEXT',
};

describe('extractResumeText', () => {
  it('routes application/pdf to the pdf parser', async () => {
    const text = await extractResumeText(
      { bytes, mime: 'application/pdf', filename: 'r.pdf' }, fakeParsers);
    expect(text).toBe('PDF RESUME TEXT');
  });

  it('routes a .docx to the docx parser', async () => {
    const text = await extractResumeText(
      { bytes,
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        filename: 'r.docx' }, fakeParsers);
    expect(text).toBe('DOCX RESUME TEXT');
  });

  it('rejects an unsupported type (e.g. legacy .doc)', async () => {
    await expect(extractResumeText(
      { bytes, mime: 'application/msword', filename: 'r.doc' }, fakeParsers),
    ).rejects.toBeInstanceOf(UnsupportedResumeError);
  });

  it('rejects a file that parses to empty/whitespace text', async () => {
    const emptyParsers: Parsers = { pdf: async () => '   \n ', docx: async () => '' };
    await expect(extractResumeText(
      { bytes, mime: 'application/pdf', filename: 'r.pdf' }, emptyParsers),
    ).rejects.toBeInstanceOf(EmptyResumeError);
  });
});
