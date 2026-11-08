import mongoose from 'mongoose';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';

let memServer: any = null;

export async function connectDb(uri?: string) {
  let target = uri ?? env.MONGO_URI;
  if (!target || env.USE_IN_MEMORY_DB) {
    // Zero-setup local dev: spin up an embedded MongoDB (downloads a binary on first run).
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memServer = await MongoMemoryServer.create({ instance: { dbName: 'ai_sales_agent' } });
    target = memServer.getUri();
    logger.warn('MONGO_URI not set — using an in-memory MongoDB. Data is lost on restart.');
  }
  mongoose.set('strictQuery', true);
  // Small pool: free hosts have a fraction of a CPU; dozens of parallel DB sockets only add memory and latency.
  await mongoose.connect(target!, { autoIndex: true, maxPoolSize: 10, minPoolSize: 1 });
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes().catch(() => m.init())));
  logger.info('MongoDB connected');
}

export async function disconnectDb() {
  await mongoose.disconnect();
  if (memServer) await memServer.stop();
}
