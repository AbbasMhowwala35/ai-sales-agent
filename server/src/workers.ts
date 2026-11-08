import { registerHandler } from './queue/queue.js';
import { processDocumentJob, websiteJob } from './routes/knowledge.js';
import { discoverJob } from './routes/leadgen.js';
import { dialCall, downloadRecording } from './services/calls/lifecycle.js';
import { runSimulatedCall } from './services/calls/simulate.js';
import { analyzeCall } from './services/calls/analysis.js';

export function registerJobHandlers() {
  registerHandler('knowledge.process', (p, j) => processDocumentJob(p, j), 1); // one at a time: PDFs are memory-heavy
  registerHandler('knowledge.website', (p, j) => websiteJob(p, j), 1);
  registerHandler('leads.discover', (p, j) => discoverJob(p, j), 2);
  registerHandler('leads.prioritize', async (p, j) => {
    const { Business, Lead } = await import('./models/index.js');
    const { prioritizeLeads } = await import('./services/leads/priority.js');
    const b = await Business.findById(j.businessId).lean();
    if (!b) return;
    const ids = p.all ? (await Lead.find({ businessId: j.businessId }, { _id: 1 }).lean()).map((l: any) => l._id) : p.leadIds;
    if (p.all) await Lead.updateMany({ businessId: j.businessId }, p.reaudit ? { $unset: { websiteAudit: 1, priority: 1, priorityReason: 1 } } : { $unset: { priority: 1, priorityReason: 1 } });
    await prioritizeLeads(b, ids);
  }, 2);
  registerHandler('calls.dial', (p, j) => dialCall(p.callId, j.businessId!, p.ignoreWindow), 10);
  registerHandler('calls.simulate', (p, j) => runSimulatedCall(p.callId, j.businessId!), 5);
  registerHandler('calls.analyze', (p, j) => analyzeCall(p.callId, j.businessId!), 3);
  registerHandler('recordings.download', (p, j) => downloadRecording(p.recordingId, j.businessId!), 2);
}
