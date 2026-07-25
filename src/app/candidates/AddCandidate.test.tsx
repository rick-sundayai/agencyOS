// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AddCandidate from './AddCandidate';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

beforeEach(() => { vi.restoreAllMocks(); });

describe('AddCandidate', () => {
  it('uploads a file then shows a pre-filled, editable review form', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith('/upload')) {
        return new Response(JSON.stringify({
          draft_id: 'd1',
          fields: { full_name: 'Ada Lovelace', email: 'ada@x.com', phone: null,
            current_title: 'Engineer', location: 'London' },
          preview: 'resume…',
        }), { status: 201 });
      }
      return new Response(JSON.stringify({ candidate_id: 'c1', embedding_status: 'embedded' }),
        { status: 201 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AddCandidate />);
    const file = new File([new Uint8Array([1])], 'r.pdf', { type: 'application/pdf' });
    await userEvent.upload(screen.getByLabelText(/resume file/i), file);

    await waitFor(() => expect(screen.getByDisplayValue('Ada Lovelace')).toBeInTheDocument());
    expect(screen.getByDisplayValue('ada@x.com')).toBeInTheDocument();
  });

  it('blocks confirm when the name has been cleared', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      draft_id: 'd1',
      fields: { full_name: 'Ada', email: null, phone: null, current_title: null, location: null },
      preview: '',
    }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    render(<AddCandidate />);
    await userEvent.upload(screen.getByLabelText(/resume file/i),
      new File([new Uint8Array([1])], 'r.pdf', { type: 'application/pdf' }));
    await waitFor(() => screen.getByDisplayValue('Ada'));

    await userEvent.clear(screen.getByLabelText(/full name/i));
    expect(screen.getByRole('button', { name: /save candidate/i })).toBeDisabled();
  });

  it('warns when the candidate saved but embedding failed', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith('/upload')) {
        return new Response(JSON.stringify({
          draft_id: 'd1',
          fields: { full_name: 'Ada', email: null, phone: null, current_title: null, location: null },
          preview: 'resume text preview',
        }), { status: 201 });
      }
      return new Response(JSON.stringify(
        { candidate_id: 'c1', document_id: 'doc1', embedding_status: 'failed' }), { status: 201 });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<AddCandidate />);
    await userEvent.upload(screen.getByLabelText(/resume file/i),
      new File([new Uint8Array([1])], 'r.pdf', { type: 'application/pdf' }));
    await waitFor(() => screen.getByDisplayValue('Ada'));
    await userEvent.click(screen.getByRole('button', { name: /save candidate/i }));
    await waitFor(() => expect(screen.getByText(/search indexing failed/i)).toBeInTheDocument());
  });

  it('returns to the picker with no warning after a fully successful save', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith('/upload')) {
        return new Response(JSON.stringify({
          draft_id: 'd1',
          fields: { full_name: 'Ada', email: null, phone: null, current_title: null, location: null },
          preview: 'p',
        }), { status: 201 });
      }
      return new Response(JSON.stringify(
        { candidate_id: 'c1', document_id: 'doc1', embedding_status: 'embedded' }), { status: 201 });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<AddCandidate />);
    await userEvent.upload(screen.getByLabelText(/resume file/i),
      new File([new Uint8Array([1])], 'r.pdf', { type: 'application/pdf' }));
    await waitFor(() => screen.getByDisplayValue('Ada'));
    await userEvent.click(screen.getByRole('button', { name: /save candidate/i }));
    await waitFor(() => expect(screen.getByLabelText(/resume file/i)).toBeInTheDocument());
    expect(screen.queryByText(/search indexing failed/i)).not.toBeInTheDocument();
  });

  it('coerces a null extracted name to an empty required field and shows the preview', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      draft_id: 'd1',
      fields: { full_name: null, email: 'x@y.com', phone: null, current_title: null, location: null },
      preview: 'PARSED RESUME PREVIEW',
    }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<AddCandidate />);
    await userEvent.upload(screen.getByLabelText(/resume file/i),
      new File([new Uint8Array([1])], 'r.pdf', { type: 'application/pdf' }));
    await waitFor(() => screen.getByDisplayValue('x@y.com'));
    expect((screen.getByLabelText(/full name/i) as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('button', { name: /save candidate/i })).toBeDisabled();
    expect(screen.getByText('PARSED RESUME PREVIEW')).toBeInTheDocument();
  });
});
