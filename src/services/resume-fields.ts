import { z } from 'zod';

export const PrefilledFieldsSchema = z.strictObject({
  full_name: z.string().min(1).nullable().catch(null),
  email: z.string().min(1).nullable().catch(null),
  phone: z.string().min(1).nullable().catch(null),
  current_title: z.string().min(1).nullable().catch(null),
  location: z.string().min(1).nullable().catch(null),
});
export type PrefilledFields = z.infer<typeof PrefilledFieldsSchema>;

const ALL_NULL: PrefilledFields = {
  full_name: null, email: null, phone: null, current_title: null, location: null,
};

export type CompleteFn = (prompt: string) => Promise<string>;

const PROMPT = (text: string) =>
  `Extract the candidate's contact and headline fields from this resume. ` +
  `Respond with ONLY a JSON object with exactly these keys: ` +
  `full_name, email, phone, current_title, location. ` +
  `Use null for any field you cannot find. Do not invent values.\n\nRESUME:\n${text}`;

/** Strip ```json fences and grab the first {...} block, so minor formatting from the
 * model can't break extraction. */
function coerceJson(raw: string): unknown {
  const fenced = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try { return JSON.parse(fenced.slice(start, end + 1)); } catch { return null; }
}

export async function extractCandidateFields(
  text: string, complete?: CompleteFn,
): Promise<PrefilledFields> {
  let raw: string;
  try {
    const run = complete ?? defaultCompleter();
    raw = await run(PROMPT(text));
  } catch { return { ...ALL_NULL }; }
  const parsed = PrefilledFieldsSchema.safeParse(coerceJson(raw));
  return parsed.success ? parsed.data : { ...ALL_NULL };
}

const MODEL = 'gemini-2.5-flash';

export function defaultCompleter(): CompleteFn {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('resume-fields: set GEMINI_API_KEY');
  return async (prompt: string) => {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0 },
        }),
      },
    );
    if (!res.ok) throw new Error(`gemini generateContent failed: ${res.status}`);
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  };
}
