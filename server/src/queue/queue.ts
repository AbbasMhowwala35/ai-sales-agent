import os from 'node:os';
import { Job } from '../models/index.js';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';

/**
 * Durable MongoDB-backed job queue.
 *  - atomic claim via findOneAndUpdate (safe with many worker processes)
 *  - retries with exponential backoff, max attempts
 *  - stale lock recovery (crashed workers)
 *  - optional uniqueKey to de-duplicate in-flight jobs
 *  - per-type concurrency
 */
export type JobHandler = (payload: any, job: { id: string; attempts: number; businessId?: string }) => Promise<unknown>;

interface Registered { handler: JobHandler; concurrency: number; running: number }
const handlers = new Map<string, Registered>();
const workerId = `${os.hostname()}:${process.pid}`;
const LOCK_TIMEOUT_MS = 10 * 60 * 1000;
let timer: NodeJS.Timeout | null = null;
let stopping = false;

export function registerHandler(type: string, handler: JobHandler, concurrency = 2) {
  handlers.set(type, { handler, concurrency, running: 0 });
}

export async function enqueue(
  type: string,
  payload: Record<string, unknown>,
  opts: { businessId?: unknown; runAt?: Date; maxAttempts?: number; uniqueKey?: string } = {},
) {
  try {
    return await Job.create({
      type,
      payload,
      businessId: opts.businessId,
      runAt: opts.runAt ?? new Date(),
      maxAttempts: opts.maxAttempts ?? 3,
      uniqueKey: opts.uniqueKey,
    });
  } catch (e: any) {
    if (e?.code === 11000 && opts.uniqueKey) return null; // already queued
    throw e;
  }
}

function backoffMs(attempts: number) {
  return Math.min(30 * 60_000, 2 ** attempts * 5_000);
}

async function claim(type: string) {
  const now = new Date();
  return Job.findOneAndUpdate(
    {
      type,
      $or: [
        { status: 'queued', runAt: { $lte: now } },
        { status: 'running', lockedAt: { $lt: new Date(now.getTime() - LOCK_TIMEOUT_MS) } },
      ],
    },
    { $set: { status: 'running', lockedAt: now, lockedBy: workerId }, $inc: { attempts: 1 } },
    { sort: { runAt: 1 }, returnDocument: 'after' },
  );
}

async function runOne(type: string, reg: Registered) {
  const job = await claim(type);
  if (!job) return false;
  reg.running++;
  try {
    await reg.handler(job.payload, { id: String(job._id), attempts: job.attempts, businessId: job.businessId ? String(job.businessId) : undefined });
    await Job.updateOne({ _id: job._id }, { $set: { status: 'completed', completedAt: new Date(), lockedAt: null } });
  } catch (err: any) {
    const final = job.attempts >= job.maxAttempts;
    logger.warn({ type, jobId: String(job._id), attempts: job.attempts, err: err?.message }, 'job failed');
    await Job.updateOne(
      { _id: job._id },
      {
        $set: {
          status: final ? 'failed' : 'queued',
          lastError: String(err?.message ?? err).slice(0, 2000),
          runAt: new Date(Date.now() + backoffMs(job.attempts)),
          lockedAt: null,
        },
      },
    );
  } finally {
    reg.running--;
  }
  return true;
}

/** Process available jobs once (used by tests and the poll loop). Resolves when no more claimable work. */
export async function drain(maxRounds = 200) {
  for (let i = 0; i < maxRounds; i++) {
    let did = false;
    for (const [type, reg] of handlers) {
      if (await runOne(type, reg)) did = true;
    }
    if (!did) return;
  }
}

async function tick() {
  if (stopping) return;
  for (const [type, reg] of handlers) {
    while (reg.running < reg.concurrency) {
      // fire-and-forget; each runOne claims at most one job
      const p = runOne(type, reg);
      const got = await Promise.race([p, new Promise((r) => setTimeout(() => r('pending'), 50))]);
      if (got === false) break;
    }
  }
}

export function startWorkers() {
  if (timer) return;
  stopping = false;
  timer = setInterval(() => void tick().catch((e) => logger.error(e, 'queue tick')), env.QUEUE_POLL_MS);
  logger.info({ workerId, types: [...handlers.keys()] }, 'queue workers started');
}

export function stopWorkers() {
  stopping = true;
  if (timer) clearInterval(timer);
  timer = null;
}
