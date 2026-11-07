import { MongoMemoryServer } from 'mongodb-memory-server';
import fs from 'node:fs';

let mongod: MongoMemoryServer | undefined;

/** Uses MONGO_TEST_URI if provided, otherwise boots an in-memory MongoDB (set MONGOMS_SYSTEM_BINARY to reuse a local mongod). */
export async function setup() {
  if (!process.env.MONGO_TEST_URI) {
    mongod = await MongoMemoryServer.create();
    process.env.MONGO_TEST_URI = mongod.getUri();
  }
}
export async function teardown() {
  await mongod?.stop();
  fs.rmSync('./.test-storage', { recursive: true, force: true });
}
