'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Fields = {
  full_name: string; email: string | null; phone: string | null;
  current_title: string | null; location: string | null;
};

const UPLOAD_ERROR: Record<string, string> = {
  unsupported_type: 'Upload a PDF or Word (.docx) file.',
  empty_resume: "Couldn't read any text from that file — it may be scanned or empty.",
  file_too_large: 'That file is too large (max 10 MB).',
  no_file: 'Choose a file to upload.',
};

export default function AddCandidate() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [fields, setFields] = useState<Fields | null>(null);
  const [preview, setPreview] = useState('');

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const fd = new FormData();
      fd.set('file', file);
      const res = await fetch('/api/candidates/upload', { method: 'POST', body: fd });
      const body = await res.json();
      if (!res.ok) { setError(UPLOAD_ERROR[body.error] ?? 'Upload failed — try again.'); return; }
      setDraftId(body.draft_id);
      // full_name is required by the form; the extractor may return null, so coerce to ''.
      setFields({ ...body.fields, full_name: body.fields.full_name ?? '' });
      setPreview(body.preview ?? '');
    } catch { setError('Upload failed — try again.'); }
    finally { setBusy(false); }
  }

  async function onConfirm(e: React.FormEvent) {
    e.preventDefault();
    if (!draftId || !fields || !fields.full_name.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/candidates/confirm', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ draft_id: draftId, fields }),
      });
      if (!res.ok) { setError('Save failed — try again.'); return; }
      const body = await res.json().catch(() => ({}));
      setDraftId(null); setFields(null);
      setNotice(body.embedding_status === 'failed'
        ? 'Candidate saved, but search indexing failed — open the candidate to retry.'
        : null);
      router.refresh();
    } catch { setError('Save failed — try again.'); }
    finally { setBusy(false); }
  }

  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFields((f) => (f ? { ...f, [k]: e.target.value } : f));

  if (!fields) {
    return (
      <div className="add-candidate">
        <label className="btn btn-primary" htmlFor="resume-file">
          {busy ? 'Reading…' : 'Add candidate'}
        </label>
        <input id="resume-file" type="file" accept=".pdf,.docx" aria-label="Resume file"
          onChange={onFile} disabled={busy} className="visually-hidden" />
        {error && <p className="sourcing-error">{error}</p>}
        {notice && <p className="add-candidate-notice">{notice}</p>}
      </div>
    );
  }

  return (
    <form className="add-candidate-review" onSubmit={onConfirm}>
      <label>Full name<input aria-label="Full name" value={fields.full_name}
        onChange={set('full_name')} /></label>
      <label>Email<input aria-label="Email" value={fields.email ?? ''} onChange={set('email')} /></label>
      <label>Phone<input aria-label="Phone" value={fields.phone ?? ''} onChange={set('phone')} /></label>
      <label>Title<input aria-label="Title" value={fields.current_title ?? ''}
        onChange={set('current_title')} /></label>
      <label>Location<input aria-label="Location" value={fields.location ?? ''}
        onChange={set('location')} /></label>
      {preview && <pre className="add-candidate-preview">{preview}</pre>}
      <button type="submit" className="btn btn-primary"
        disabled={busy || !fields.full_name.trim()}>
        {busy ? 'Saving…' : 'Save candidate'}
      </button>
      {error && <p className="sourcing-error">{error}</p>}
    </form>
  );
}
