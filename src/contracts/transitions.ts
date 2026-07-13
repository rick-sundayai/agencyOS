import type { DecisionState } from './decision';

export const TRANSITIONS: Record<DecisionState, readonly DecisionState[]> = {
  proposed: ['approved', 'cancelled'],
  approved: ['executing', 'cancelled'],
  executing: ['executed', 'failed'],
  executed: ['undone'],
  failed: ['executing', 'cancelled'],
  cancelled: [],
  undone: [],
};

export function canTransition(from: DecisionState, to: DecisionState): boolean {
  return TRANSITIONS[from].includes(to);
}
