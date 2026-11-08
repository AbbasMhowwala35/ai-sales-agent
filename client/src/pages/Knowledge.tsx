import { useRef, useState, type FormEvent } from 'react';
import { AiAssist } from '../components/AiAssist';
import { Link } from 'react-router-dom';
import { UploadCloud, Globe, FileText, RefreshCw, Trash2, MessageSquareText, Lock } from 'lucide-react';
import { useApi } from '../lib/useApi';
import { post, upload, del } from '../lib/api';
import { useAuth } from '../store/auth';
import { toast } from '../store/ui';
import { PageHeader, Panel, Pill, STATUS_TONE, Spinner, Modal, Field, Confirm, Empty, ErrorState, TableSkeleton, cx } from '../components/ui';
import { fmtDate, fmtNum } from '../lib/format';

const TYPE_LABEL: Record<string, string> = { pdf: 'PDF', docx: 'Word', txt: 'Text', md: 'Markdown', csv: 'CSV', website: 'Website', faq: 'FAQs', script: 'Scripts', profile: 'Profile', manual: 'Note' };

export default function Knowledge() {
  const can = useAuth((s) => s.can('knowledge:write'));
  const [busy, setBusy] = useState(false);
  const { data, error, reload } = useApi<any>('/knowledge', { poll: busy ? 2000 : 0 }); // poll while processing
  const live = data;
  const nowBusy = !!data?.documents?.some((d: any) => ['pending', 'processing'].includes(d.status));
  if (nowBusy !== busy) setBusy(nowBusy);
  const [modal, setModal] = useState<'website' | 'text' | null>(null);
  const [view, setView] = useState<string | null>(null);
  const [remove, setRemove] = useState<any>(null);
  const [drag, setDrag] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const doUpload = async (files: FileList | File[]) => {
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append('files', f));
    setUploading(true);
    try { const r = await upload('/knowledge/upload', fd); toast.success(`${r.documents.length} file${r.documents.length > 1 ? 's' : ''} uploaded — processing now`); reload(); }
    catch (e: any) { toast.error(e.message); } finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  return (
    <>
      <PageHeader title="Knowledge base" description="Everything your agent knows. It retrieves the most relevant passages from here, live, during every call."
        actions={can && <>
          <button className="btn-secondary" onClick={() => setModal('website')}><Globe className="h-4 w-4" />Import website</button>
          <button className="btn-secondary" onClick={() => setModal('text')}><FileText className="h-4 w-4" />Write a note</button>
        </>} />
      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        <div className="space-y-6 min-w-0">
          {can && (
            <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); doUpload(e.dataTransfer.files); }}
              className={cx('rounded-panel border-2 border-dashed p-8 text-center transition-colors', drag ? 'border-signal bg-signal-soft/50' : 'border-line bg-surface')}>
              <UploadCloud className="h-8 w-8 mx-auto text-muted" />
              <p className="mt-2 font-semibold">Drop brochures, price lists, policies or case studies</p>
              <p className="text-[13px] text-muted">PDF, DOCX, TXT, Markdown or CSV · up to 15 MB each</p>
              <input ref={fileRef} type="file" multiple accept=".pdf,.docx,.txt,.md,.csv" className="hidden" onChange={(e) => e.target.files && doUpload(e.target.files)} />
              <button className="btn-primary mt-4" disabled={uploading} onClick={() => fileRef.current?.click()}>{uploading && <Spinner />}Choose files</button>
            </div>
          )}
          <Panel title="Sources" actions={live && <span className="text-[13px] text-muted tnum">{fmtNum(live.totals.chunks)} passages · {live.engine.embeddings}</span>} bodyClass="overflow-x-auto">
            {error && <div className="p-4"><ErrorState message={error} onRetry={reload} /></div>}
            {!live && !error && <TableSkeleton rows={4} />}
            {live && !live.documents.length && <Empty title="No knowledge yet">Fill in Business Settings or upload a document to start training your agent.</Empty>}
            {live?.documents?.length > 0 && (
              <table className="w-full text-sm">
                <thead><tr><th className="th">Source</th><th className="th">Type</th><th className="th">Status</th><th className="th text-right">Passages</th><th className="th">Updated</th><th className="th" /></tr></thead>
                <tbody>
                  {live.documents.map((d: any) => (
                    <tr key={d._id} className="hover:bg-sunken/50">
                      <td className="td max-w-[280px]">
                        <button className="font-semibold text-left hover:underline truncate block max-w-full" onClick={() => setView(d._id)}>{d.title}</button>
                        {d.system && <span className="text-xs text-muted inline-flex items-center gap-1"><Lock className="h-3 w-3" />From <Link to="/settings" className="underline">Business settings</Link></span>}
                        {d.status === 'failed' && <p className="text-xs text-danger">{d.error}</p>}
                      </td>
                      <td className="td text-muted">{TYPE_LABEL[d.type] ?? d.type}</td>
                      <td className="td"><Pill tone={STATUS_TONE[d.status]}>{['pending', 'processing'].includes(d.status) && <Spinner className="h-3 w-3" />}{d.status === 'ready' ? 'Ready' : d.status === 'failed' ? 'Failed' : 'Processing'}</Pill></td>
                      <td className="td text-right tnum">{d.chunkCount}</td>
                      <td className="td text-muted whitespace-nowrap">{fmtDate(d.updatedAt)}</td>
                      <td className="td text-right whitespace-nowrap">
                        {can && <>
                          <button className="btn-ghost h-8 w-8 p-0" title="Re-process" aria-label={`Re-process ${d.title}`} onClick={async () => { await post(`/knowledge/${d._id}/reindex`); reload(); }}><RefreshCw className="h-4 w-4" /></button>
                          {!d.system && <button className="btn-ghost h-8 w-8 p-0" title="Delete" aria-label={`Delete ${d.title}`} onClick={() => setRemove(d)}><Trash2 className="h-4 w-4" /></button>}
                        </>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>
        <AskPanel />
      </div>
      <WebsiteModal open={modal === 'website'} onClose={() => setModal(null)} onDone={reload} />
      <TextModal open={modal === 'text'} onClose={() => setModal(null)} onDone={reload} />
      <DocModal id={view} onClose={() => setView(null)} />
      <Confirm open={!!remove} onClose={() => setRemove(null)} danger title="Delete source?" confirmLabel="Delete source" message={`“${remove?.title}” will be removed and your agent will stop using it on calls.`}
        onConfirm={async () => { await del(`/knowledge/${remove._id}`); toast.success('Source deleted'); reload(); }} />
    </>
  );
}

function AskPanel() {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<{ q: string; a: any }[]>([]);
  const ask = async (e: FormEvent) => {
    e.preventDefault(); if (!q.trim()) return;
    setBusy(true);
    try { const a = await post('/knowledge/query', { question: q }); setHistory([{ q, a }, ...history].slice(0, 5)); setQ(''); }
    catch (err: any) { toast.error(err.message); } finally { setBusy(false); }
  };
  const examples = ['How much does it cost?', 'Do you offer support?', 'What makes you different?'];
  return (
    <Panel title="Test what your agent knows" className="lg:sticky lg:top-20 self-start">
      <form onSubmit={ask} className="flex gap-2">
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask a question a prospect might ask" aria-label="Question" />
        <button className="btn-primary" disabled={busy || !q.trim()}>{busy ? <Spinner /> : 'Ask'}</button>
      </form>
      {!history.length && <div className="mt-3 flex flex-wrap gap-1.5">{examples.map((x) => <button key={x} className="rounded-full border border-line px-2.5 py-1 text-xs hover:bg-sunken" onClick={() => setQ(x)}>{x}</button>)}</div>}
      <div className="mt-4 space-y-5">
        {history.map((h, i) => (
          <div key={i}>
            <p className="text-[13px] font-semibold flex gap-2"><MessageSquareText className="h-4 w-4 text-muted shrink-0 mt-0.5" />{h.q}</p>
            <p className={cx('mt-2 rounded-control p-3 text-[14px] leading-relaxed', h.a.grounded ? 'bg-signal-soft/60' : 'bg-sunken text-muted')}>{h.a.answer}</p>
            {h.a.sources?.length > 0 && <ul className="mt-2 space-y-1">{h.a.sources.slice(0, 3).map((s: any, j: number) => <li key={j} className="text-xs text-muted flex justify-between gap-2"><span className="truncate">{s.title}</span><span className="tnum shrink-0">{Math.round(s.score * 100)}% match</span></li>)}</ul>}
          </div>
        ))}
      </div>
    </Panel>
  );
}

function WebsiteModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [url, setUrl] = useState(''); const [pages, setPages] = useState(10); const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { await post('/knowledge/website', { url, maxPages: pages }); toast.success('Website import started'); onDone(); onClose(); setUrl(''); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Import a website" footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!url || busy} onClick={submit}>{busy && <Spinner />}Import website</button></>}>
      <div className="space-y-4">
        <Field label="Website address"><input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://yourcompany.com" /></Field>
        <Field label="Pages to read" hint="Pages on the same domain are read, following links from the address above. robots.txt is respected."><input className="input" type="number" min={1} max={50} value={pages} onChange={(e) => setPages(Number(e.target.value))} /></Field>
      </div>
    </Modal>
  );
}

function TextModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState(''); const [content, setContent] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { await post('/knowledge/text', { title, content }); toast.success('Note added'); onDone(); onClose(); setTitle(''); setContent(''); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Write a note" wide footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!title || content.length < 20 || busy} onClick={submit}>{busy && <Spinner />}Add note</button></>}>
      <div className="space-y-4">
        <Field label="Title"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Delivery & installation" /></Field>
        <Field label="Content" hint="At least 20 characters."><textarea className="input" rows={10} value={content} onChange={(e) => setContent(e.target.value)} /><AiAssist field="note" context={title} value={content} onApply={setContent} /></Field>
      </div>
    </Modal>
  );
}

function DocModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, error, reload } = useApi<any>(id ? `/knowledge/${id}` : null);
  return (
    <Modal open={!!id} onClose={onClose} title={data?.title ?? 'Source'} wide>
      {!data ? (error ? <ErrorState message={error} onRetry={reload} /> : <Spinner />) : (
        <div className="space-y-3">
          <p className="text-[13px] text-muted">{data.source} · {fmtNum(data.charCount)} characters · {data.chunkCount} passages</p>
          {data.chunks.map((c: any) => <p key={c._id} className="rounded-control bg-sunken p-3 text-[13px] whitespace-pre-wrap leading-relaxed">{c.text}</p>)}
          {!data.chunks.length && <p className="text-muted">No passages indexed.</p>}
        </div>
      )}
    </Modal>
  );
}
