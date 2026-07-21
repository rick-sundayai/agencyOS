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

  it('renders the shortlist with fit badges when done', async () => {
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
});
