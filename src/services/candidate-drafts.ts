import type { ObjectStore } from './storage';
import type { ResumeFile } from './resume-extract';
import type { PrefilledFields } from './resume-fields';

export const stagingKey = (orgId: string, draftId: string) =>
  `staging/${orgId}/${draftId}`;
export const stagingTextKey = (orgId: string, draftId: string) =>
  `staging/${orgId}/${draftId}.txt`;

export type DraftDeps = {
  store: ObjectStore;
  extractText: (f: ResumeFile) => Promise<string>;
  extractFields: (text: string) => Promise<PrefilledFields>;
  newId: () => string;
};

export async function prepareCandidateDraft(
  orgId: string, file: ResumeFile, deps: DraftDeps,
): Promise<{ draft_id: string; fields: PrefilledFields; preview: string }> {
  const text = await deps.extractText(file);          // throws before any staging on bad file
  const fields = await deps.extractFields(text);
  const draftId = deps.newId();
  await deps.store.put(stagingKey(orgId, draftId), file.bytes, file.mime);
  await deps.store.put(
    stagingTextKey(orgId, draftId), new TextEncoder().encode(text), 'text/plain');
  return { draft_id: draftId, fields, preview: text.slice(0, 500) };
}
