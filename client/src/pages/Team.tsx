import { useState } from 'react';
import { Plus, Copy, Check, X } from 'lucide-react';
import { useApi } from '../lib/useApi';
import { post, patch, del, qs } from '../lib/api';
import { useAuth } from '../store/auth';
import { toast } from '../store/ui';
import { PageHeader, Panel, Pill, Spinner, Modal, Field, Avatar, Confirm, Tabs, TableSkeleton, Pagination, ErrorState , Pending } from '../components/ui';
import { fmtDateTime, timeAgo, cap } from '../lib/format';

const PERM_LABEL: Record<string, string> = {
  'business:write': 'Edit business settings', 'knowledge:write': 'Manage knowledge base', 'agents:write': 'Configure AI agents', 'leadgen:run': 'Run lead discovery',
  'leads:write': 'Edit leads, notes & reminders', 'leads:approve': 'Approve leads & export', 'leads:delete': 'Delete leads', 'campaigns:write': 'Manage campaigns',
  'calls:write': 'Place & end calls', 'recordings:listen': 'Listen to recordings', 'recordings:download': 'Download recordings', 'team:manage': 'Manage team',
  'compliance:write': 'Manage Do-Not-Call list', 'audit:read': 'View audit log',
};
const ROLE_DESC: Record<string, string> = { owner: 'Full control, including billing and other owners', admin: 'Everything except managing owners', manager: 'Runs campaigns, approves leads, trains agents', agent: 'Works leads and listens to calls', viewer: 'Read-only access' };

export default function Team() {
  const { user, can } = useAuth();
  const [tab, setTab] = useState<'members' | 'roles' | 'audit'>('members');
  const { data, error, reload } = useApi<any>('/team');
  const [inviting, setInviting] = useState(false);
  const [remove, setRemove] = useState<any>(null);
  const manage = can('team:manage');
  return (
    <>
      <PageHeader title="Team & permissions" description="Invite your team and control who can approve leads, run campaigns and hear recordings."
        actions={manage && <button className="btn-primary" onClick={() => setInviting(true)}><Plus className="h-4 w-4" />Invite member</button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'members', label: 'Members', count: data?.members?.length }, { id: 'roles', label: 'Roles' }, ...(can('audit:read') ? [{ id: 'audit' as const, label: 'Audit log' }] : [])]} />
      {error && <ErrorState message={error} onRetry={reload} />}
      {tab === 'members' && <Panel bodyClass="overflow-x-auto">
        {!data ? <Pending error={error} onRetry={reload} /> : (
          <table className="w-full text-sm">
            <thead><tr><th className="th">Member</th><th className="th">Role</th><th className="th">Status</th><th className="th">Last sign-in</th><th className="th" /></tr></thead>
            <tbody>{data.members.map((m: any) => {
              const self = m.userId === user?.id;
              return (
                <tr key={m.id}>
                  <td className="td"><div className="flex items-center gap-3"><Avatar name={m.name} size={32} /><div><p className="font-semibold">{m.name}{self && <span className="text-muted font-normal"> (you)</span>}</p><p className="text-xs text-muted">{m.email}</p></div></div></td>
                  <td className="td">{manage && !self && (m.role !== 'owner' || user?.role === 'owner') ? (
                    <select className="input h-8 w-auto" value={m.role} onChange={async (e) => { try { await patch(`/team/${m.id}`, { role: e.target.value }); toast.success(`${m.name} is now ${e.target.value}`); reload(); } catch (err: any) { toast.error(err.message); } }} aria-label={`Role for ${m.name}`}>
                      {data.roles.filter((r: string) => r !== 'owner' || user?.role === 'owner').map((r: string) => <option key={r} value={r}>{cap(r)}</option>)}
                    </select>) : <span className="capitalize">{m.role}</span>}</td>
                  <td className="td"><Pill tone={m.status === 'active' ? 'green' : m.status === 'invited' ? 'amber' : 'grey'}>{m.status}</Pill></td>
                  <td className="td text-muted">{m.lastLoginAt ? timeAgo(m.lastLoginAt) : 'Never'}</td>
                  <td className="td text-right whitespace-nowrap">{manage && !self && <>
                    {m.status !== 'invited' && <button className="btn-ghost btn-sm" onClick={async () => { await patch(`/team/${m.id}`, { status: m.status === 'active' ? 'disabled' : 'active' }); reload(); }}>{m.status === 'active' ? 'Disable' : 'Enable'}</button>}
                    <button className="btn-ghost btn-sm text-danger" onClick={() => setRemove(m)}>Remove</button>
                  </>}</td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </Panel>}
      {tab === 'roles' && data && <Panel bodyClass="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr><th className="th">Permission</th>{data.roles.map((r: string) => <th key={r} className="th text-center capitalize" title={ROLE_DESC[r]}>{r}</th>)}</tr></thead>
          <tbody>{Object.entries(data.permissions).map(([perm, roles]: any) => (
            <tr key={perm}><td className="td">{PERM_LABEL[perm] ?? perm}</td>{data.roles.map((r: string) => <td key={r} className="td text-center">{roles.includes(r) ? <Check className="h-4 w-4 text-signal inline" aria-label="Allowed" /> : <X className="h-4 w-4 text-muted/50 inline" aria-label="Not allowed" />}</td>)}</tr>
          ))}</tbody>
        </table>
      </Panel>}
      {tab === 'audit' && <AuditLog />}
      <Invite open={inviting} onClose={() => setInviting(false)} onDone={reload} roles={data?.roles ?? []} isOwner={user?.role === 'owner'} />
      <Confirm open={!!remove} onClose={() => setRemove(null)} danger title={`Remove ${remove?.name}?`} confirmLabel="Remove member" message="They’ll lose access immediately. Leads assigned to them stay assigned until you reassign them."
        onConfirm={async () => { try { await del(`/team/${remove.id}`); reload(); toast.success('Member removed'); } catch (e: any) { toast.error(e.message); } }} />
    </>
  );
}

function Invite({ open, onClose, onDone, roles, isOwner }: { open: boolean; onClose: () => void; onDone: () => void; roles: string[]; isOwner: boolean }) {
  const [email, setEmail] = useState(''); const [role, setRole] = useState('agent'); const [busy, setBusy] = useState(false);
  const [link, setLink] = useState(''); const [copied, setCopied] = useState(false);
  const close = () => { onClose(); setLink(''); setEmail(''); };
  return (
    <Modal open={open} onClose={close} title="Invite a team member" footer={link ? <button className="btn-primary" onClick={close}>Done</button> : <><button className="btn-secondary" onClick={close}>Cancel</button>
      <button className="btn-primary" disabled={!email || busy} onClick={async () => { setBusy(true); try { const r = await post('/team/invite', { email, role }); setLink(r.inviteLink); onDone(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); } }}>{busy && <Spinner />}Send invite</button></>}>
      {link ? (
        <div className="space-y-3">
          <p>Invitation sent to <span className="font-semibold">{email}</span>. If email isn’t set up on the server, share this link with them:</p>
          <div className="flex gap-2"><input className="input" readOnly value={link} aria-label="Invite link" /><button className="btn-secondary" onClick={() => { navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? 'Copied' : 'Copy'}</button></div>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="Email"><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Role" hint={ROLE_DESC[role]}><select className="input" value={role} onChange={(e) => setRole(e.target.value)}>{roles.filter((r) => r !== 'owner' || isOwner).map((r) => <option key={r} value={r}>{cap(r)}</option>)}</select></Field>
        </div>
      )}
    </Modal>
  );
}

function AuditLog() {
  const [page, setPage] = useState(1);
  const { data, error, reload } = useApi<any>(`/compliance/audit${qs({ page, limit: 30 })}`);
  return (
    <Panel bodyClass="overflow-x-auto">
      {!data ? <Pending error={error} onRetry={reload} /> : (
        <table className="w-full text-sm">
          <thead><tr><th className="th">When</th><th className="th">Who</th><th className="th">Action</th><th className="th">Details</th><th className="th">IP</th></tr></thead>
          <tbody>{data.items.map((a: any) => (
            <tr key={a._id}><td className="td whitespace-nowrap text-muted">{fmtDateTime(a.createdAt)}</td><td className="td">{a.userId?.name ?? 'System'}</td><td className="td font-medium">{a.action}</td><td className="td text-muted max-w-[360px] truncate">{a.meta ? JSON.stringify(a.meta) : ''}</td><td className="td text-muted tnum">{a.ip ?? ''}</td></tr>
          ))}</tbody>
        </table>
      )}
      {data && <Pagination page={page} total={data.total} limit={data.limit} onPage={setPage} />}
    </Panel>
  );
}
