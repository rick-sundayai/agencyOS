export type ResumeFile = { bytes: Uint8Array; mime: string; filename: string };
export type TextParser = (bytes: Uint8Array) => Promise<string>;
export type Parsers = { pdf: TextParser; docx: TextParser };

export class UnsupportedResumeError extends Error {
  constructor(msg = 'Unsupported resume type. Upload a PDF or Word (.docx) file.') {
    super(msg);
    this.name = 'UnsupportedResumeError';
  }
}
export class EmptyResumeError extends Error {
  constructor(msg = "Couldn't read any text from that file. It may be scanned or empty.") {
    super(msg);
    this.name = 'EmptyResumeError';
  }
}

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function kind(file: ResumeFile): 'pdf' | 'docx' {
  const name = file.filename.toLowerCase();
  if (file.mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (file.mime === DOCX_MIME || name.endsWith('.docx')) return 'docx';
  throw new UnsupportedResumeError();
}

export async function extractResumeText(
  file: ResumeFile, parsers: Parsers = defaultParsers,
): Promise<string> {
  const parser = kind(file) === 'pdf' ? parsers.pdf : parsers.docx;
  const text = (await parser(file.bytes)).trim();
  if (!text) throw new EmptyResumeError();
  return text;
}

// Dynamic imports keep these Node-only libs out of any client bundle and mirror the
// lazy-import pattern in embed.ts.
//
// NOTE: the task brief specified importing 'pdf-parse/lib/pdf-parse.js' directly
// (bypassing index.js) to dodge a debug-mode footgun in some pdf-parse releases.
// @types/pdf-parse only declares the package root ('pdf-parse'), not that deep path,
// so the deep import fails `tsc --noEmit` with TS7016 (implicit any). Inspected the
// installed pdf-parse@1.1.4's index.js: it is a bare passthrough
// (`module.exports = require('./lib/pdf-parse.js')`) with no debug-mode code, so
// importing the package root here is behaviorally identical and typechecks cleanly.
export const defaultParsers: Parsers = {
  pdf: async (bytes) => {
    const pdfParse = (await import('pdf-parse')).default;
    return (await pdfParse(Buffer.from(bytes))).text;
  },
  docx: async (bytes) => {
    const mammoth = await import('mammoth');
    return (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value;
  },
};
