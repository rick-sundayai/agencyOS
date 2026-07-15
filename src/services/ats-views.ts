import { and, count, desc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import {
  applications, candidate_documents, candidates, clients, job_orders, scores,
} from '../db/schema';

export const PIPELINE_STAGES = [
  'sourced', 'screened', 'submitted', 'interviewing', 'offer', 'placed', 'rejected',
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export async function listJobOrders(orgId: string) {
  const jobs = await db
    .select({
      id: job_orders.id,
      title: job_orders.title,
      kind: job_orders.kind,
      status: job_orders.status,
      created_at: job_orders.created_at,
      client_name: clients.name,
    })
    .from(job_orders)
    .leftJoin(clients, eq(job_orders.client_id, clients.id))
    .where(eq(job_orders.org_id, orgId))
    .orderBy(desc(job_orders.created_at));

  const counts = await db
    .select({ job_order_id: applications.job_order_id, n: count() })
    .from(applications)
    .where(eq(applications.org_id, orgId))
    .groupBy(applications.job_order_id);
  const byJob = new Map(counts.map((c) => [c.job_order_id, Number(c.n)]));

  return jobs.map((j) => ({ ...j, candidate_count: byJob.get(j.id) ?? 0 }));
}

export async function getJobOrderPipeline(orgId: string, jobOrderId: string) {
  const [job] = await db
    .select({
      id: job_orders.id,
      title: job_orders.title,
      description: job_orders.description,
      kind: job_orders.kind,
      status: job_orders.status,
      must_haves: job_orders.must_haves,
      nice_to_haves: job_orders.nice_to_haves,
      client_name: clients.name,
    })
    .from(job_orders)
    .leftJoin(clients, eq(job_orders.client_id, clients.id))
    .where(and(eq(job_orders.org_id, orgId), eq(job_orders.id, jobOrderId)));
  if (!job) return null;

  const rows = await db
    .select({
      application_id: applications.id,
      stage: applications.stage,
      updated_at: applications.updated_at,
      candidate_id: candidates.id,
      candidate_name: candidates.full_name,
      current_title: candidates.current_title,
    })
    .from(applications)
    .innerJoin(candidates, eq(applications.candidate_id, candidates.id))
    .where(and(eq(applications.org_id, orgId), eq(applications.job_order_id, jobOrderId)))
    .orderBy(desc(applications.updated_at));

  const jobScores = await db
    .select({
      candidate_id: scores.candidate_id,
      fit_rating: scores.fit_rating,
      weighted_score: scores.weighted_score,
      created_at: scores.created_at,
    })
    .from(scores)
    .where(and(eq(scores.org_id, orgId), eq(scores.job_order_id, jobOrderId)))
    .orderBy(desc(scores.created_at));
  const latestScore = new Map<string, (typeof jobScores)[number]>();
  for (const s of jobScores) {
    if (!latestScore.has(s.candidate_id)) latestScore.set(s.candidate_id, s);
  }

  return {
    ...job,
    applications: rows.map((r) => ({ ...r, score: latestScore.get(r.candidate_id) ?? null })),
  };
}

export async function listCandidates(orgId: string) {
  return db
    .select()
    .from(candidates)
    .where(eq(candidates.org_id, orgId))
    .orderBy(desc(candidates.created_at));
}

export async function getCandidateProfile(orgId: string, candidateId: string) {
  const [candidate] = await db
    .select()
    .from(candidates)
    .where(and(eq(candidates.org_id, orgId), eq(candidates.id, candidateId)));
  if (!candidate) return null;

  const documents = await db
    .select()
    .from(candidate_documents)
    .where(and(
      eq(candidate_documents.org_id, orgId),
      eq(candidate_documents.candidate_id, candidateId),
    ))
    .orderBy(desc(candidate_documents.version));

  const apps = await db
    .select({
      id: applications.id,
      stage: applications.stage,
      updated_at: applications.updated_at,
      job_order_id: job_orders.id,
      job_title: job_orders.title,
    })
    .from(applications)
    .innerJoin(job_orders, eq(applications.job_order_id, job_orders.id))
    .where(and(eq(applications.org_id, orgId), eq(applications.candidate_id, candidateId)))
    .orderBy(desc(applications.updated_at));

  const candidateScores = await db
    .select({
      id: scores.id,
      job_order_id: scores.job_order_id,
      fit_rating: scores.fit_rating,
      weighted_score: scores.weighted_score,
      prompt_version: scores.prompt_version,
      model: scores.model,
      created_at: scores.created_at,
    })
    .from(scores)
    .where(and(eq(scores.org_id, orgId), eq(scores.candidate_id, candidateId)))
    .orderBy(desc(scores.created_at));

  return { candidate, documents, applications: apps, scores: candidateScores };
}

export async function listClients(orgId: string) {
  const rows = await db
    .select()
    .from(clients)
    .where(eq(clients.org_id, orgId))
    .orderBy(clients.name);

  const counts = await db
    .select({ client_id: job_orders.client_id, n: count() })
    .from(job_orders)
    .where(and(eq(job_orders.org_id, orgId), eq(job_orders.status, 'open')))
    .groupBy(job_orders.client_id);
  const byClient = new Map(counts.map((c) => [c.client_id, Number(c.n)]));

  return rows.map((c) => ({ ...c, open_jobs: byClient.get(c.id) ?? 0 }));
}
