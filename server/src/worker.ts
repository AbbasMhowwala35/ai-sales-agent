/** Standalone worker process (scale horizontally: run N of these with RUN_WORKERS=false on API nodes). */
import { env } from './config/env.js';
import { connectDb } from './db.js';
import { registerJobHandlers } from './workers.js';
import { startWorkers } from './queue/queue.js';
import { startScheduler } from './services/campaigns/scheduler.js';
import { logger } from './lib/logger.js';

connectDb().then(() => {
  registerJobHandlers();
  startWorkers();
  startScheduler(env.SCHEDULER_TICK_MS);
  logger.info('worker process started');
});
