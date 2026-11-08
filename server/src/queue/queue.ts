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
    const job = await Job.create({
      type,
      payload,
      businessId: opts.businessId,
      runAt: opts.runAt ?? new Date(),
      maxAttempts: opts.maxAttempts ?? 3,
      uniqueKey: opts.uniqueKey,
    });
    if (!opts.runAt || opts.runAt.getTime() <= Date.now()) kick();
    return job;
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

/** Run one claimed job to completion and record the result. */
async function execute(type: string, reg: Registered, job: any) {
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
    ).catch(() => undefined);
  }
}

/** Claim + run one job of a type, awaiting completion (tests and drain()). */
async function runOne(type: string, reg: Registered) {
  reg.running++;
  try {
    const job = await claim(type);
    if (!job) return false;
    await execute(type, reg, job);
    return true;
  } finally { reg.running--; }
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

/*
 * Poll loop, built for small servers with a remote database (e.g. 0.1 CPU on Render + MongoDB Atlas):
 *  - never overlaps: a new round only starts after the previous one finished
 *  - a slot is reserved BEFORE the claim query, so slow queries can't fan out into a flood of claims
 *  - one cheap query asks "which job types have work?" — idle cost is a single query every few seconds
 *  - fast while there is work, backs off to IDLE_MAX_MS when idle; enqueue() in this process wakes it at once
 */
const IDLE_MAX_MS = 5_000;
let ticking = false;
let idleDelay = env.QUEUE_POLL_MS;

function schedule(ms: number) {
  if (stopping) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void tick(), ms);
}
/** Wake the loop soon (new work was enqueued, or a job finished and freed a slot). */
export function kick() { if (!stopping && timer && !ticking) { idleDelay = env.QUEUE_POLL_MS; schedule(50); } }

async function claimAndStart(type: string, reg: Registered) {
  reg.running++; // reserve the slot first
  let job: any;
  try { job = await claim(type); } catch (e) { reg.running--; throw e; }
  if (!job) { reg.running--; return false; }
  void execute(type, reg, job).finally(() => { reg.running--; kick(); });
  return true;
}

async function tick() {
  if (stopping || ticking) return;
  ticking = true;
  let found = false;
  try {
    const now = new Date();
    const ready = new Set<string>(await Job.distinct('type', {
      type: { $in: [...handlers.keys()] },
      $or: [{ status: 'queued', runAt: { $lte: now } }, { status: 'running', lockedAt: { $lt: new Date(now.getTime() - LOCK_TIMEOUT_MS) } }],
    }));
    for (const type of ready) {
      const reg = handlers.get(type)!;
      while (!stopping && reg.running < reg.concurrency) {
        if (!(await claimAndStart(type, reg))) break;
        found = true;
      }
    }
  } catch (e) {
    logger.error(e, 'queue tick');
  } finally {
    ticking = false;
    idleDelay = found ? env.QUEUE_POLL_MS : Math.min(IDLE_MAX_MS, Math.round(idleDelay * 1.6));
    schedule(found ? 250 : idleDelay);
  }
}

export function startWorkers() {
  if (timer) return;
  stopping = false;
  idleDelay = env.QUEUE_POLL_MS;
  schedule(env.QUEUE_POLL_MS);
  logger.info({ workerId, types: [...handlers.keys()] }, 'queue workers started');
}

export function stopWorkers() {
  stopping = true;
  if (timer) clearTimeout(timer);
  timer = null;
}
