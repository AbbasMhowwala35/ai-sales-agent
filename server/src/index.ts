import { env } from './config/env.js';
import { connectDb, disconnectDb } from './db.js';
import { createApp } from './app.js';
import { logger } from './lib/logger.js';
import { registerJobHandlers } from './workers.js';
import { startWorkers, stopWorkers } from './queue/queue.js';
import { startScheduler, stopScheduler } from './services/campaigns/scheduler.js';

async function main() {
  await connectDb();
  registerJobHandlers();
  if (process.env.SEED_DEMO === 'true') {
    const { seedDemo, DEMO_EMAIL, DEMO_PASSWORD } = await import('./services/demo.js');
    await seedDemo();
    logger.info(`Demo login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  }
  if (env.RUN_WORKERS) {
    startWorkers();
    startScheduler(env.SCHEDULER_TICK_MS);
  }
  const server = createApp().listen(env.PORT, () => {
    logger.info(`API listening on http://localhost:${env.PORT}  (telephony: ${env.TELEPHONY_PROVIDER}, llm: ${env.LLM_PROVIDER})`);
  });
  const shutdown = async (sig: string) => {
    logger.info({ sig }, 'shutting down');
    stopScheduler(); stopWorkers();
    server.close();
    await disconnectDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((e) => { logger.fatal(e); process.exit(1); });
