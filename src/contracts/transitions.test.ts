import { describe, it, expect } from 'vitest';
import { canTransition } from './transitions';

describe('canTransition', () => {
  it.each([
    ['proposed', 'approved', true],
    ['proposed', 'cancelled', true],
    ['approved', 'executing', true],
    ['approved', 'cancelled', true],   // undo-window cancel
    ['executing', 'executed', true],
    ['executing', 'failed', true],
    ['executed', 'undone', true],
    ['failed', 'executing', true],     // orchestrator retry
    ['failed', 'cancelled', true],     // permanent failure (e.g. compliance deny) abandoned, not retried
    ['proposed', 'executed', false],   // no skipping execution
    ['executed', 'approved', false],
    ['cancelled', 'approved', false],  // terminal
    ['undone', 'executing', false],    // terminal
  ] as const)('%s → %s = %s', (from, to, expected) => {
    expect(canTransition(from, to)).toBe(expected);
  });
});
