import type { RosterRun } from './agent-roster';
import type { AgentThroughput } from './agent-throughput';
import { throughputFromRuns } from './agent-throughput';
import type { PipelineStage } from './ats-views';

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

  const decisionsPerDay = recentDecisions.length / 30;
  const autoRunRate = recentDecisions.length === 0
    ? 0
    : recentDecisions.filter((d) => d.approved_by === 'policy').length / recentDecisions.length;

  const tierCounts = new Map<string, number>();
  for (const d of recentDecisions) tierCounts.set(d.tier, (tierCounts.get(d.tier) ?? 0) + 1);
  const tierSplit = TIER_ORDER
    .filter((tier) => tierCounts.has(tier))
    .map((tier) => ({ tier, count: tierCounts.get(tier)! }));

  return {
    decisionsPerDay,
    autoRunRate,
    tierSplit,
    stageDistribution: [],
    placementsPerMonth: [],
    timeToFillDays: null,
    candidateSources: [],
    agentPerformance: throughputFromRuns(input.agentRuns),
  };
}
