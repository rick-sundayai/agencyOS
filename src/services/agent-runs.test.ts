import { describe, it, expect, beforeAll } from 'vitest';
import { createFixtureOrg } from '../test/fixtures';
import { insertAgentRun } from './agent-runs';

let orgId: string;

beforeAll(async () => {
  orgId = await createFixtureOrg();
});

describe('insertAgentRun', () => {
  it('inserts a run with model telemetry', async () => {
    const run = await insertAgentRun({
      org_id: orgId, agent: 'screening', workflow: 'agencyos-screening',
      model: 'gemini-2.5-flash', prompt_version: 'v2.2.0',
      tokens_in: 1200, tokens_out: 300, status: 'succeeded',
    });
    expect(run.id).toBeTruthy();
    expect(run.finished_at).not.toBeNull();
  });

  it('rejects an unknown agent', async () => {
    await expect(insertAgentRun({ org_id: orgId, agent: 'nope', workflow: 'w' })).rejects.toThrow();
  });
});
