// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SourceFromJobDiva from './SourceFromJobDiva';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

beforeEach(() => { fetchMock.mockReset(); push.mockReset(); });

describe('SourceFromJobDiva', () => {
  it('imports and navigates to the job with sourcing auto-start', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ job_order_id: 'j-9', created: true }), { status: 200 }));
    render(<SourceFromJobDiva />);
    await userEvent.type(screen.getByPlaceholderText(/jobdiva job/i), 'JD-42');
    await userEvent.click(screen.getByRole('button', { name: /source/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/jobs/j-9?source=1'));
  });

  it('renders an inline error for an unknown number', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'job_not_found_in_jobdiva' }), { status: 404 }));
    render(<SourceFromJobDiva />);
    await userEvent.type(screen.getByPlaceholderText(/jobdiva job/i), 'JD-00');
    await userEvent.click(screen.getByRole('button', { name: /source/i }));
    expect(await screen.findByText(/not found in JobDiva/i)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('renders an inline error when JobDiva is down', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'jobdiva_unavailable' }), { status: 502 }));
    render(<SourceFromJobDiva />);
    await userEvent.type(screen.getByPlaceholderText(/jobdiva job/i), 'JD-42');
    await userEvent.click(screen.getByRole('button', { name: /source/i }));
    expect(await screen.findByText(/JobDiva is unavailable/i)).toBeInTheDocument();
  });
});
