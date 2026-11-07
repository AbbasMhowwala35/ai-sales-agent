import { connectDb, disconnectDb } from '../db.js';
import { registerJobHandlers } from '../workers.js';
import { seedDemo, DEMO_EMAIL, DEMO_PASSWORD } from '../services/demo.js';

await connectDb();
registerJobHandlers();
await seedDemo();
console.log(`\nDemo workspace ready → sign in with ${DEMO_EMAIL} / ${DEMO_PASSWORD}\n`);
await disconnectDb();
process.exit(0);
