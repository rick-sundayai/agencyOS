// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { TopBar } from './TopBar';

class MockEventSource {
  static instances: MockEventSource[] = [];
  onmessage: ((ev: { data: string }) => void) | null = null;
  constructor(public url: string) { MockEventSource.instances.push(this); }
  close() {}
}

beforeEach(() => {
  MockEventSource.instances = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).EventSource = MockEventSource;
});

describe('TopBar notification bell', () => {
  it('shows no count badge when there are no pending Decisions', () => {
    render(<TopBar pendingCount={0} />);
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeDefined();
  });

  it('shows the seeded pending-Decision count in the button\'s accessible name', () => {
    render(<TopBar pendingCount={4} />);
    expect(screen.getByRole('button', { name: 'Notifications, 4 decisions pending' })).toBeDefined();
  });

  it('updates live off the Cockpit stream', () => {
    render(<TopBar pendingCount={0} />);
    act(() => {
      MockEventSource.instances[0].onmessage?.({
        data: JSON.stringify({ queue: [{}, {}] }),
      });
    });
    expect(screen.getByRole('button', { name: 'Notifications, 2 decisions pending' })).toBeDefined();
  });

  it('does not render RecruiterPro\'s "Ask the team" button or a global search box', () => {
    render(<TopBar pendingCount={0} />);
    expect(screen.queryByText(/Ask the team/)).toBeNull();
    expect(screen.queryByRole('searchbox')).toBeNull();
  });
});
