// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SourcingPanel from './SourcingPanel';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonRes(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

beforeEach(() => fetchMock.mockReset());

describe('SourcingPanel', () => {
  it('shows the Source button when idle', async () => {
    fetchMock.mockReturnValue(jsonRes({ run: null, shortlist: null }));
    render(<SourcingPanel jobId="j1" autoStart={false} />);
    expect(await screen.findByRole('button', { name: /source candidates/i })).toBeEnabled();
  });

  it('shows phase progress for an active run and disables the button', async () => {
    fetchMock.mockReturnValue(jsonRes({
      run: { id: 'r1', phase: 'checking_jobdiva', stats: { pool_matches: 2 }, error: null },
      shortlist: null,
    }));
    render(<SourcingPanel jobId="j1" autoStart={false} />);
    expect(await screen.findByText(/checking jobdiva/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sourcing/i })).toBeDisabled();
  });

  it('renders the shortlist with a fit badge, no raw distance, once screened', async () => {
    fetchMock.mockReturnValue(jsonRes({
      run: { id: 'r1', phase: 'done', stats: { shortlisted: 1 }, error: null },
      shortlist: [{
        candidate_id: 'c1', full_name: 'Ada L', current_title: 'Engineer',
        distance: 0.41, fit_rating: 'yes',
      }],
    }));
    render(<SourcingPanel jobId="j1" autoStart={false} />);
    expect(await screen.findByText('Ada L')).toBeInTheDocument();
    expect(screen.getByText(/strong fit/i)).toBeInTheDocument();
    expect(screen.queryByText(/distance/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/close match|possible match/i)).not.toBeInTheDocument();
  });

  it('shows a "Close match" chip, no raw distance, for an unscreened candidate under the threshold', async () => {
    fetchMock.mockReturnValue(jsonRes({
      run: { id: 'r1', phase: 'done', stats: { shortlisted: 1 }, error: null },
      shortlist: [{
        candidate_id: 'c2', full_name: 'Ben K', current_title: 'Engineer',
        distance: 0.3, fit_rating: null,
      }],
    }));
    render(<SourcingPanel jobId="j1" autoStart={false} />);
    expect(await screen.findByText(/close match/i)).toBeInTheDocument();
    expect(screen.queryByText(/distance/i)).not.toBeInTheDocument();
  });

  it('shows a "Possible match" chip for an unscreened candidate at/above the threshold', async () => {
    fetchMock.mockReturnValue(jsonRes({
      run: { id: 'r1', phase: 'done', stats: { shortlisted: 1 }, error: null },
      shortlist: [{
        candidate_id: 'c3', full_name: 'Cara M', current_title: 'Engineer',
        distance: 0.7, fit_rating: null,
      }],
    }));
    render(<SourcingPanel jobId="j1" autoStart={false} />);
    expect(await screen.findByText(/possible match/i)).toBeInTheDocument();
  });

  it('shows the error and a retry button when failed', async () => {
    fetchMock.mockReturnValue(jsonRes({
      run: { id: 'r1', phase: 'failed', stats: {}, error: 'Sourcing run timed out' , },
      shortlist: null,
    }));
    render(<SourcingPanel jobId="j1" autoStart={false} />);
    expect(await screen.findByText(/timed out/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeEnabled();
  });

  it('POSTs on click', async () => {
    fetchMock.mockImplementation((url: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'POST'
        ? jsonRes({ sourcing_run_id: 'r9' }, 201)
        : jsonRes({ run: null, shortlist: null }));
    render(<SourcingPanel jobId="j1" autoStart={false} />);
    await userEvent.click(await screen.findByRole('button', { name: /source candidates/i }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/jobs/j1/source', expect.objectContaining({ method: 'POST' }));
    });
  });

  it('auto-starts a run when ?source=1 and nothing is active on load', async () => {
    fetchMock.mockImplementation((url: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'POST'
        ? jsonRes({ sourcing_run_id: 'r9' }, 201)
        : jsonRes({ run: null, shortlist: null }));
    render(<SourcingPanel jobId="j1" autoStart={true} />);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/jobs/j1/source', expect.objectContaining({ method: 'POST' }));
    });
    const postCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
    expect(postCalls).toHaveLength(1);
  });

  it('does not re-fire a second sourcing run when an already-active run later becomes terminal', async () => {
    let getCall = 0;
    fetchMock.mockImplementation((url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonRes({ sourcing_run_id: 'r9' }, 201);
      getCall += 1;
      if (getCall === 1) {
        return jsonRes({
          run: { id: 'r1', phase: 'searching_pool', stats: {}, error: null },
          shortlist: null,
        });
      }
      return jsonRes({
        run: { id: 'r1', phase: 'done', stats: {}, error: null },
        shortlist: null,
      });
    });

    render(<SourcingPanel jobId="j1" autoStart={true} />);

    // Initial load: a run is already active, so autoStart must not fire a POST.
    expect(await screen.findByText(/searching internal pool/i)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toBe(false);

    // Drive a re-poll (as the component's own interval would) that returns a
    // terminal phase, simulating the active run finishing while mounted.
    fetchMock.mockClear();
    fetchMock.mockImplementation((url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonRes({ sourcing_run_id: 'r9' }, 201);
      return jsonRes({
        run: { id: 'r1', phase: 'done', stats: {}, error: null },
        shortlist: null,
      });
    });

    // The component polls every 2.5s while a run is active; wait for the
    // re-poll (driven by its own interval) to land and flip the run to done.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /source candidates/i })).toBeEnabled();
    }, { timeout: 5000, interval: 100 });

    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toBe(false);
  });
});
