import type { RosterRun } from './agent-roster';
import type { AgentThroughput } from './agent-throughput';
import { throughputFromRuns } from './agent-throughput';
import { PIPELINE_STAGES, type PipelineStage } from './ats-views';

export type DecisionForAnalytics = { tier: string; approved_by: string | null; proposed_at: Date };
export type ApplicationForAnalytics = { stage: string };
export type PlacementForAnalytics = { start_date: string | null; application_created_at: Date };
export type CandidateForAnalytics = { source: string | null };

export type AnalyticsInput = {
  decisions: DecisionForAnalytics[];
  applications: ApplicationForAnalytics[];
  placements: PlacementForAnalytics[];
  candidates: CandidateForAnalytics[];
  agentRuns: RosterRun[];
};

export type AnalyticsViewModel = {
  decisionsPerDay: number;
  autoRunRate: number;
  tierSplit: { tier: string; count: number }[];
  stageDistribution: { stage: PipelineStage; count: number }[];
  placementsPerMonth: { month: string; count: number }[];
  timeToFillDays: number | null;
  candidateSources: { source: string; count: number }[];
  agentPerformance: AgentThroughput[];
};

const DECISIONS_WINDOW_MS = 30 * 24 * 60 * 60_000;
const TIER_ORDER = ['1', '2', '3', 'risk'];

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Pure selector: derive the Analytics page's whole metric view-model from raw rows
 * already scoped to the org. Mirrors computeHealthSignals — no DB/IO, no fabricated
 * figures; a metric this app can't honestly back today is simply absent from the return
 * type rather than approximated.
 */
export function computeAnalytics(input: AnalyticsInput, now: Date = new Date()): AnalyticsViewModel {
  const decisionsSince = new Date(now.getTime() - DECISIONS_WINDOW_MS);
  const recentDecisions = input.decisions.filter((d) => d.proposed_at >= decisionsSince);

  const decisionsPerDay = round1(recentDecisions.length / 30);
  const autoRunRate = recentDecisions.length === 0
    ? 0
    : recentDecisions.filter((d) => d.approved_by === 'policy').length / recentDecisions.length;

  const tierCounts = new Map<string, number>();
  for (const d of recentDecisions) tierCounts.set(d.tier, (tierCounts.get(d.tier) ?? 0) + 1);
  const tierSplit = TIER_ORDER
    .filter((tier) => tierCounts.has(tier))
    .map((tier) => ({ tier, count: tierCounts.get(tier)! }));

  const stageCounts = new Map<PipelineStage, number>(PIPELINE_STAGES.map((s) => [s, 0]));
  for (const app of input.applications) {
    const stage = app.stage as PipelineStage;
    if (stageCounts.has(stage)) stageCounts.set(stage, stageCounts.get(stage)! + 1);
  }
  const stageDistribution = PIPELINE_STAGES.map((stage) => ({ stage, count: stageCounts.get(stage)! }));

  const PLACEMENTS_MONTHS = 6;
  const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const months: string[] = [];
  for (let i = PLACEMENTS_MONTHS - 1; i >= 0; i -= 1) {
    months.push(monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
  }
  const placementMonthCounts = new Map<string, number>(months.map((m) => [m, 0]));
  for (const p of input.placements) {
    if (p.start_date === null) continue;
    const key = monthKey(new Date(`${p.start_date}T00:00:00Z`));
    if (placementMonthCounts.has(key)) placementMonthCounts.set(key, placementMonthCounts.get(key)! + 1);
  }
  const placementsPerMonth = months.map((month) => ({ month, count: placementMonthCounts.get(month)! }));

  const filledPlacements = input.placements.filter((p): p is PlacementForAnalytics & { start_date: string } => p.start_date !== null);
  const timeToFillDays = filledPlacements.length === 0
    ? null
    : round1(
        filledPlacements.reduce((sum, p) => {
          const days = (new Date(`${p.start_date}T00:00:00Z`).getTime() - p.application_created_at.getTime()) / (24 * 60 * 60_000);
          return sum + days;
        }, 0) / filledPlacements.length,
      );

  const sourceCounts = new Map<string, number>();
  for (const c of input.candidates) {
    const source = c.source && c.source.trim() !== '' ? c.source : 'Unknown';
    sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
  }
  const candidateSources = [...sourceCounts.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));

  return {
    decisionsPerDay,
    autoRunRate,
    tierSplit,
    stageDistribution,
    placementsPerMonth,
    timeToFillDays,
    candidateSources,
    agentPerformance: throughputFromRuns(input.agentRuns),
  };
}
