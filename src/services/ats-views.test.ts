import { describe, it, expect, beforeAll } from 'vitest';
import { makeAtsFixtures, type AtsFixtures } from '../test/fixtures';
import {
  listJobOrders, getJobOrderPipeline, listCandidates, getCandidateProfile, listClients,
  getPipelineBoard, PIPELINE_STAGES,
} from './ats-views';

// Valid uuid that belongs to no org — proves org isolation.
const OTHER_ORG = '00000000-0000-7000-8000-000000000000';

let f: AtsFixtures;

beforeAll(async () => {
  f = await makeAtsFixtures();
});

describe('listJobOrders', () => {
  it('returns the job with client name and candidate count', async () => {
    const jobs = await listJobOrders(f.orgId);
    const job = jobs.find((j) => j.id === f.jobId);
    expect(job).toBeDefined();
    expect(job!.client_name).toBe(`Client ${f.tag}`);
    expect(job!.candidate_count).toBe(2);
  });
});

describe('getJobOrderPipeline', () => {
  it('returns applications with candidates and latest score attached', async () => {
    const job = await getJobOrderPipeline(f.orgId, f.jobId);
    expect(job).not.toBeNull();
    expect(job!.applications).toHaveLength(2);
    const a = job!.applications.find((x) => x.candidate_id === f.cand1)!;
    expect(a.stage).toBe('sourced');
    expect(a.score?.fit_rating).toBe('yes');
    const b = job!.applications.find((x) => x.candidate_id === f.cand2)!;
    expect(b.score).toBeNull();
  });

  it('picks the newest score for a candidate with multiple scores, not an arbitrary one', async () => {
    // cand1 has two scores in the fixtures: an older one backdated 2 days
    // (fit_rating 'no', weighted_score 0.12) and the current one (fit_rating 'yes',
    // weighted_score 0.87). If the sort/dedup direction were ever reversed, this
    // would return the older 'no'/0.12 score instead.
    const job = await getJobOrderPipeline(f.orgId, f.jobId);
    const a = job!.applications.find((x) => x.candidate_id === f.cand1)!;
    expect(a.score?.fit_rating).toBe('yes');
    expect(Number(a.score?.weighted_score)).toBeCloseTo(0.87);
  });

  it('returns null for another org (isolation)', async () => {
    expect(await getJobOrderPipeline(OTHER_ORG, f.jobId)).toBeNull();
  });
});

describe('getCandidateProfile', () => {
  it('returns documents, applications with job title, and scores', async () => {
    const p = await getCandidateProfile(f.orgId, f.cand1);
    expect(p).not.toBeNull();
    expect(p!.documents).toHaveLength(1);
    expect(p!.applications[0].job_title).toBe(`Job ${f.tag}`);
    expect(p!.scores[0].fit_rating).toBe('yes');
  });

  it('returns null for another org (isolation)', async () => {
    expect(await getCandidateProfile(OTHER_ORG, f.cand1)).toBeNull();
  });
});

describe('getPipelineBoard', () => {
  it('returns one column per canonical stage, in order', async () => {
    const board = await getPipelineBoard(f.orgId);
    expect(board.map((c) => c.stage)).toEqual([...PIPELINE_STAGES]);
  });

  it('groups applications by stage with candidate name and job order title', async () => {
    const board = await getPipelineBoard(f.orgId);
    const sourced = board.find((c) => c.stage === 'sourced')!;
    const card = sourced.cards.find((c) => c.candidate_name === `Cand A ${f.tag}`);
    expect(card).toBeDefined();
    expect(card!.job_title).toBe(`Job ${f.tag}`);
  });

  it('renders an empty column for a stage with no applications', async () => {
    const board = await getPipelineBoard(f.orgId);
    const placed = board.find((c) => c.stage === 'placed')!;
    expect(placed.cards).toEqual([]);
  });

  it('returns only empty columns for another org (isolation)', async () => {
    const board = await getPipelineBoard(OTHER_ORG);
    expect(board.every((c) => c.cards.length === 0)).toBe(true);
  });
});

describe('listCandidates / listClients', () => {
  it('lists the fixture candidates', async () => {
    const ids = (await listCandidates(f.orgId)).map((c) => c.id);
    expect(ids).toContain(f.cand1);
    expect(ids).toContain(f.cand2);
  });

  it('lists the client with its open job count', async () => {
    const client = (await listClients(f.orgId)).find((c) => c.id === f.clientId);
    expect(client).toBeDefined();
    expect(client!.open_jobs).toBe(1);
  });
});
