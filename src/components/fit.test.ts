import { describe, it, expect } from 'vitest';
import { fitMeta, matchTier } from './fit';

describe('fitMeta', () => {
  it('resolves a known rating to its label and tone', () => {
    expect(fitMeta('yes')).toEqual({ label: 'Strong fit', tone: 'fit-good' });
    expect(fitMeta('borderline')).toEqual({ label: 'Borderline', tone: 'fit-warn' });
    expect(fitMeta('no')).toEqual({ label: 'Poor fit', tone: 'fit-bad' });
  });

  it('returns null for a null, undefined, or unrecognized rating', () => {
    expect(fitMeta(null)).toBeNull();
    expect(fitMeta(undefined)).toBeNull();
    expect(fitMeta('unknown')).toBeNull();
  });
});

describe('matchTier', () => {
  it('labels a distance below the 0.55 threshold as a close match', () => {
    expect(matchTier(0.2)).toEqual({ label: 'Close match', tone: 'match-close' });
    expect(matchTier(0.549)).toEqual({ label: 'Close match', tone: 'match-close' });
  });

  it('labels a distance at or above the 0.55 threshold as a possible match', () => {
    expect(matchTier(0.55)).toEqual({ label: 'Possible match', tone: 'match-possible' });
    expect(matchTier(0.9)).toEqual({ label: 'Possible match', tone: 'match-possible' });
  });
});
